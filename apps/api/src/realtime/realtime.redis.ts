import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Build the two Redis clients the Socket.IO adapter needs (pub + sub).
 *
 * We lazy-build these rather than making them Nest providers because the
 * Socket.IO adapter owns their lifecycle once we hand them over.
 *
 * Graceful-degradation: if REDIS_URL is not set or the connection fails,
 * we return `null` and the gateway falls back to in-memory mode (single
 * instance). That keeps the dev experience friction-free on a laptop
 * without Redis running, while production still gets horizontal scale
 * when REDIS_URL is set.
 */
export interface RedisAdapterClients {
  pub: Redis;
  sub: Redis;
}

const logger = new Logger('RealtimeRedis');

export async function buildRedisAdapterClients(): Promise<RedisAdapterClients | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    logger.warn('REDIS_URL not set — Socket.IO will run in single-instance mode.');
    return null;
  }
  try {
    const pub = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
    const sub = pub.duplicate();
    await pub.connect();
    await sub.connect();
    logger.log(`Redis adapter connected (${url.replace(/:[^:@/]+@/, ':****@')}).`);
    return { pub, sub };
  } catch (err) {
    logger.error(`Redis adapter unavailable, running in single-instance mode. Reason: ${(err as Error).message}`);
    return null;
  }
}
