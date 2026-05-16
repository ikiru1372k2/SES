import { useEffect, useState } from 'react';

// Returns `value` trailing-debounced by `delayMs`.
export function useDebouncedValue<T>(value: T, delayMs: number = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
