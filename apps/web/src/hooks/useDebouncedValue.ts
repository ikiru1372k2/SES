import { useEffect, useState } from 'react';

// Returns `value` trailing-debounced by `delayMs`. Typical use: pass a raw
// search input value in, feed the returned debounced value into an
// expensive filter/memoization boundary so typing doesn't re-run the
// filter N times per second.
//
//   const [query, setQuery] = useState('');
//   const debounced = useDebouncedValue(query, 200);
//   const filtered = useMemo(() => heavyFilter(rows, debounced), [rows, debounced]);
export function useDebouncedValue<T>(value: T, delayMs: number = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
