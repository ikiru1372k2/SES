import { useEffect, useState } from 'react';
import { Modal } from './Modal';

type ShortcutRow = [keys: string, description: string];
type ShortcutGroup = { heading: string; rows: ShortcutRow[] };

// Global shortcuts available everywhere that uses AppShell.
// Page-specific overlays (e.g. Escalation Center) call preventDefault()
// on their own '?' handler, which suppresses this one.
const GLOBAL_GROUPS: ShortcutGroup[] = [
  {
    heading: 'Navigation',
    rows: [
      ['N', 'Create new process (Dashboard)'],
      ['Esc', 'Close panel, menu, or dialog'],
    ],
  },
  {
    heading: 'Workspace',
    rows: [
      ['R', 'Run audit'],
      ['S', 'Save version'],
    ],
  },
  {
    heading: 'Help',
    rows: [['?', 'Open this help overlay']],
  },
];

export function GlobalShortcutOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;
      if (isTyping) return;
      if (event.key !== '?') return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard shortcuts"
      description="Press ? anywhere to open this list. Shortcuts are ignored while typing."
      size="md"
      footer={
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          Close
        </button>
      }
    >
      <div className="space-y-4">
        {GLOBAL_GROUPS.map((group) => (
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
