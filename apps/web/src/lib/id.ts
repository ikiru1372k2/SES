export function createId(prefix?: string): string {
  const cryptoApi = globalThis.crypto;
  const value = cryptoApi?.randomUUID ? cryptoApi.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return prefix ? `${prefix}-${value}` : value;
}
