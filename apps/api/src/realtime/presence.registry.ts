import { Injectable, Logger } from '@nestjs/common';
import type { PresenceInfo } from './realtime.types';

/**
 * In-memory presence tracker.
 *
 * This is intentionally *not* backed by Redis for v1: presence only needs to
 * survive the life of a connection, and Socket.IO's Redis adapter broadcasts
 * `presence.*` events across instances, so every node builds its own local
 * view from the events it observes. That's simpler than a distributed hash
 * and good enough until we have multi-node traffic that demands it.
 *
 * Swap-out path: replace the two Maps with `redis.hset(presence:<proc>, ...)`
 * and you get a consistent global view. No call-site changes needed.
 */
@Injectable()
export class PresenceRegistry {
  private readonly logger = new Logger(PresenceRegistry.name);

  /** processCode -> (socketId -> PresenceInfo) */
  private byProcess = new Map<string, Map<string, PresenceInfo>>();

  /** socketId -> processCode (for cleanup on disconnect) */
  private socketToProcess = new Map<string, string>();

  join(processCode: string, info: PresenceInfo): PresenceInfo[] {
    let bucket = this.byProcess.get(processCode);
    if (!bucket) {
      bucket = new Map();
      this.byProcess.set(processCode, bucket);
    }
    bucket.set(info.socketId, info);
    this.socketToProcess.set(info.socketId, processCode);
    this.logger.debug(`presence join ${info.userCode} -> ${processCode} (total: ${bucket.size})`);
    return Array.from(bucket.values());
  }

  leave(socketId: string): { processCode: string; info: PresenceInfo } | null {
    const processCode = this.socketToProcess.get(socketId);
    if (!processCode) return null;
    this.socketToProcess.delete(socketId);
    const bucket = this.byProcess.get(processCode);
    if (!bucket) return null;
    const info = bucket.get(socketId);
    bucket.delete(socketId);
    if (!bucket.size) this.byProcess.delete(processCode);
    if (!info) return null;
    this.logger.debug(`presence leave ${info.userCode} <- ${processCode}`);
    return { processCode, info };
  }

  move(socketId: string, patch: Partial<Pick<PresenceInfo, 'tab' | 'focusCode'>>): PresenceInfo | null {
    const processCode = this.socketToProcess.get(socketId);
    if (!processCode) return null;
    const bucket = this.byProcess.get(processCode);
    const current = bucket?.get(socketId);
    if (!current || !bucket) return null;
    const next: PresenceInfo = {
      ...current,
      ...patch,
      lastHeartbeat: new Date().toISOString(),
    };
    bucket.set(socketId, next);
    return next;
  }

  heartbeat(socketId: string): void {
    const processCode = this.socketToProcess.get(socketId);
    if (!processCode) return;
    const current = this.byProcess.get(processCode)?.get(socketId);
    if (!current) return;
    current.lastHeartbeat = new Date().toISOString();
  }

  snapshot(processCode: string): PresenceInfo[] {
    return Array.from(this.byProcess.get(processCode)?.values() ?? []);
  }

  /** For tests & debugging */
  stats() {
    return {
      processes: this.byProcess.size,
      sockets: this.socketToProcess.size,
    };
  }
}
