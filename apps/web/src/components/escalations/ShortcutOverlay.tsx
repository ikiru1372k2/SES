import { Modal } from '../shared/Modal';

const GROUPS: Array<{ heading: string; rows: Array<[string, string]> }> = [
  {
    heading: 'Navigation',
    rows: [
      ['j / k or ↓ / ↑', 'Move row selection'],
      ['Enter', 'Open the selected manager panel'],
      ['/', 'Focus search'],
      ['Esc', 'Close panel or clear selection'],
    ],
  },
  {
    heading: 'Bulk actions (when rows are selected)',
    rows: [
      ['c', 'Open the bulk composer'],
      ['a', 'Acknowledge selected'],
      ['s', 'Snooze selected'],
      ['e', 'Re-escalate selected'],
      ['r', 'Mark selected resolved'],
    ],
  },
  {
    heading: 'Help',
    rows: [['?', 'Open this help overlay']],
  },
];

export function ShortcutOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="Shortcuts are ignored while typing in a text field."
      size="md"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          Close
        </button>
      }
    >
      <div className="space-y-4">
        {GROUPS.map((group) => (
          <section key={group.heading}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {group.heading}
            </h3>
            <ul className="space-y-1">
              {group.rows.map(([key, label]) => (
                <li
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-2 py-1.5 text-sm dark:border-gray-800"
                >
                  <span className="text-gray-700 dark:text-gray-200">{label}</span>
                  <kbd className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                    {key}
                  </kbd>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
