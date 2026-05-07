import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';

interface TxState {
  client: PoolClient;
}

export const txStorage = new AsyncLocalStorage<TxState>();

export function currentTxClient(): PoolClient | undefined {
  return txStorage.getStore()?.client;
}
