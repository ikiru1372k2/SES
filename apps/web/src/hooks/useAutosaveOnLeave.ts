import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Flushes an in-progress edit (compose draft, inline correction, note) any
 * time the user is about to lose the current context: tab hide / switch,
 * pagehide / beforeunload, or a client-side route change.
 *
 * The `flush` callback is read through a ref so callers can pass an inline
 * arrow without re-registering the unload listeners on every render.
 *
 * Callers must keep the flush idempotent — it may fire more than once for a
 * single navigation (e.g. visibilitychange + pagehide in the same flow).
 */
export function useAutosaveOnLeave(flush: () => void | Promise<void>, enabled: boolean = true): void {
  const flushRef = useRef(flush);
  // React purity rule: never mutate a ref during render. Sync through an
  // effect so the unload listeners still call the latest callback without
  // touching `.current` in the render phase.
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  const location = useLocation();
  const lastPath = useRef(location.pathname + location.search);

  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      try {
        void flushRef.current();
      } catch {
        // Flush failures must never block navigation.
      }
    };
    const onVis = () => {
      if (document.hidden) run();
    };
    // pagehide fires on mobile Safari where beforeunload is unreliable; both
    // together cover desktop and mobile.
    window.addEventListener('pagehide', run);
    window.addEventListener('beforeunload', run);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', run);
      window.removeEventListener('beforeunload', run);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const key = location.pathname + location.search;
    if (lastPath.current !== key) {
      try {
        void flushRef.current();
      } catch {
        // Swallow — route transitions must still proceed.
      }
      lastPath.current = key;
    }
  }, [enabled, location.pathname, location.search]);
}
