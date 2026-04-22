import { useEffect } from 'react';

export function ShortcutOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === '?') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  if (!open) return null;

  const rows: Array<[string, string]> = [
    ['c', 'Compose'],
    ['r', 'Resolve'],
    ['e', 'Escalate now'],
    ['s', 'Snooze'],
    ['/', 'Focus search'],
    ['j / k', 'Row navigation'],
    ['?', 'Open this help'],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Keyboard shortcuts</h2>
        <div className="mt-3 space-y-1 text-sm">
          {rows.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between rounded border border-gray-200 px-2 py-1 dark:border-gray-700">
              <kbd className="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800">{key}</kbd>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
