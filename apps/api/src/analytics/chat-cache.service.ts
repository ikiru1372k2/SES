import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

interface Entry {
  value: unknown;
  expiresAt: number;
  scope: { processCode: string; functionId: string | null };
}

const TTL_MS = (Number(process.env.ANALYTICS_CACHE_TTL_SECONDS ?? 1800) || 1800) * 1000;
const MAX_ENTRIES = 1000;

@Injectable()
export class ChatCacheService {
  private store = new Map<string, Entry>();

  key(input: {
    question: string;
    processCode: string;
    functionId: string | null;
    datasetVersion: string;
    /** Distinguish stub vs real-agent answers so they never collide. */
    useStub?: boolean;
  }): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          q: input.question.trim().toLowerCase(),
          p: input.processCode,
          f: input.functionId,
          v: input.datasetVersion,
          s: input.useStub ? 1 : 0,
        }),
      )
      .digest('hex');
  }

  get(k: string): unknown | null {
    const e = this.store.get(k);
    if (!e) return null;
    if (e.expiresAt < Date.now()) {
      this.store.delete(k);
      return null;
    }
    return e.value;
  }

  set(k: string, value: unknown, scope?: { processCode: string; functionId: string | null }): void {
    if (this.store.size >= MAX_ENTRIES) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(k, {
      value,
      expiresAt: Date.now() + TTL_MS,
      scope: scope ?? { processCode: '*', functionId: null },
    });
  }

  evictMatching(scope: { processCode: string; functionId: string | null }): number {
    let n = 0;
    for (const [k, e] of this.store) {
      if (
        e.scope.processCode === scope.processCode &&
        (scope.functionId === null || e.scope.functionId === scope.functionId)
      ) {
        this.store.delete(k);
        n++;
      }
    }
    return n;
  }
}
