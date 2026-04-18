import { AsyncLocalStorage } from 'node:async_hooks';
import { ulid } from 'ulid';

export interface RequestContextValue {
  requestId: string;
  userId?: string;
  userCode?: string;
  userEmail?: string;
}

const storage = new AsyncLocalStorage<RequestContextValue>();

export function createRequestId(existing?: string | string[]): string {
  const candidate = Array.isArray(existing) ? existing[0] : existing;
  return candidate?.trim() ? candidate.trim() : `REQ-${ulid()}`;
}

export const requestContext = {
  run<T>(value: RequestContextValue, callback: () => T): T {
    return storage.run(value, callback);
  },
  get(): RequestContextValue {
    return storage.getStore() ?? { requestId: createRequestId() };
  },
  setUser(user: Pick<RequestContextValue, 'userId' | 'userCode' | 'userEmail'>): void {
    const current = storage.getStore();
    if (current) Object.assign(current, user);
  },
};
