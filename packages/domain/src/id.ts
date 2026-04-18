import { v7 as uuidv7 } from 'uuid';

export function createId(prefix?: string): string {
  const value = uuidv7();
  return prefix ? `${prefix}-${value}` : value;
}
