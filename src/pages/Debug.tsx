import { useState } from 'react';
import { clearDebugEvents, readDebugEvents } from '../lib/debugLog';
import { Button } from '../components/shared/Button';

export function Debug() {
  const [events, setEvents] = useState(() => readDebugEvents());
  const payload = JSON.stringify(events, null, 2);

  return (
    <main className="min-h-screen bg-gray-100 p-6 text-gray-950">
      <section className="mx-auto max-w-5xl rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">SES Debug Log</h1>
            <p className="mt-1 text-sm text-gray-500">Recent browser-side crashes captured by the error boundary.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(payload)}>Copy JSON</Button>
            <Button
              variant="danger"
              onClick={() => {
                clearDebugEvents();
                setEvents([]);
              }}
            >
              Clear
            </Button>
          </div>
        </div>
        <pre className="mt-5 max-h-[70vh] overflow-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100">{payload}</pre>
      </section>
    </main>
  );
}
