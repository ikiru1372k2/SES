import { useEffect, useMemo, useRef } from 'react';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

// Debounced, per-key invalidator. Realtime bursts (e.g. bulk-action
// followed by SLA cron firing for each) otherwise trigger N refetches
// per key — each one a separate HTTP round trip. This coalesces them
// into one refetch per unique key per window.
//
// Usage:
//   const invalidate = useCoalescedInvalidator(queryClient, 250);
//   invalidate(['escalations', processId]);
//   invalidate(['tracking-events']);
//
// Cleanup: the returned function flushes pending timers when the
// subscribing component unmounts, so no late refetch happens post-unmount.

export function useCoalescedInvalidator(queryClient: QueryClient, windowMs: number = 250) {
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const current = pending.current;
    return () => {
      for (const timer of current.values()) clearTimeout(timer);
      current.clear();
    };
  }, []);

  return useMemo(
    () => (queryKey: QueryKey) => {
      const signature = JSON.stringify(queryKey);
      const existing = pending.current.get(signature);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        pending.current.delete(signature);
        void queryClient.invalidateQueries({ queryKey });
      }, windowMs);
      pending.current.set(signature, timer);
    },
    [queryClient, windowMs],
  );
}
