interface BulkSelectionBarProps {
  selectedTrackingIds: Set<string>;
  onCompose: () => void;
  onAck: () => void;
  onSnooze: () => void;
  onReescalate: () => void;
  onResolve: () => void;
  onClear: () => void;
}

export function BulkSelectionBar({
  selectedTrackingIds,
  onCompose,
  onAck,
  onSnooze,
  onReescalate,
  onResolve,
  onClear,
}: BulkSelectionBarProps) {
  if (selectedTrackingIds.size === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm">
      <span className="font-medium text-brand">
        {selectedTrackingIds.size} selected
      </span>
      <span className="text-[11px] text-gray-500">
        Shortcuts: <kbd className="rounded bg-gray-200 px-1 dark:bg-gray-700">c</kbd> compose ·{' '}
        <kbd className="rounded bg-gray-200 px-1 dark:bg-gray-700">a</kbd> ack ·{' '}
        <kbd className="rounded bg-gray-200 px-1 dark:bg-gray-700">s</kbd> snooze ·{' '}
        <kbd className="rounded bg-gray-200 px-1 dark:bg-gray-700">e</kbd> escalate ·{' '}
        <kbd className="rounded bg-gray-200 px-1 dark:bg-gray-700">r</kbd> resolve ·{' '}
        <kbd className="rounded bg-gray-200 px-1 dark:bg-gray-700">esc</kbd> clear
      </span>
      <span className="flex-1" />
      <button
        type="button"
        className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-white dark:border-gray-700 dark:hover:bg-gray-800"
        onClick={onCompose}
      >
        Compose
      </button>
      <button
        type="button"
        className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-white dark:border-gray-700 dark:hover:bg-gray-800"
        onClick={onAck}
      >
        Acknowledge
      </button>
      <button
        type="button"
        className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-white dark:border-gray-700 dark:hover:bg-gray-800"
        onClick={onSnooze}
      >
        Snooze
      </button>
      <button
        type="button"
        className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        onClick={onReescalate}
      >
        Re-escalate
      </button>
      <button
        type="button"
        className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-white dark:border-gray-700 dark:hover:bg-gray-800"
        onClick={onResolve}
      >
        Resolve
      </button>
      <button
        type="button"
        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-white dark:border-gray-700 dark:hover:bg-gray-800"
        onClick={onClear}
        aria-label="Clear selection"
      >
        Clear
      </button>
    </div>
  );
}
