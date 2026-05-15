import { ulid } from 'ulid';

export function createId(prefix?: string): string {
  const value = ulid();
  return prefix ? `${prefix}-${value}` : value;
}
