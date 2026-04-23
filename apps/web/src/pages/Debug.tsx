import { Copy, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { usePageHeader } from '../components/layout/usePageHeader';
import { clearDebugEvents, readDebugEvents } from '../lib/debugLog';

export function Debug() {
  const [events, setEvents] = useState(() => readDebugEvents());
  const payload = useMemo(() => JSON.stringify(events, null, 2), [events]);

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(payload);
  }, [payload]);

  const onClear = useCallback(() => {
    clearDebugEvents();
    setEvents([]);
  }, []);

  const headerConfig = useMemo(
    () => ({
      breadcrumbs: [
        { label: 'Dashboard', to: '/' },
        { label: 'Debug log' },
      ],
      overflowActions: [
        { id: 'copy', label: 'Copy JSON', icon: Copy, onClick: onCopy },
        { id: 'clear', label: 'Clear', icon: Trash2, variant: 'danger' as const, onClick: onClear },
      ],
    }),
    [onCopy, onClear],
  );
  usePageHeader(headerConfig);

  return (
    <AppShell>
      <section className="mx-auto w-full max-w-5xl p-6">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h1 className="text-xl font-semibold">SES Debug Log</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Recent browser-side crashes captured by the error boundary.
          </p>
          <pre className="mt-5 max-h-[70vh] overflow-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100">{payload}</pre>
        </div>
      </section>
    </AppShell>
  );
}
