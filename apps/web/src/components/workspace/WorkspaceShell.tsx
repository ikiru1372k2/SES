import type { ReactNode } from 'react';
import type { WorkspaceTab } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';

const tabs: { id: WorkspaceTab; label: string }[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'results', label: 'Audit Results' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'versions', label: 'History' },
];

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const active = useAppStore((state) => state.activeWorkspaceTab);
  const setTab = useAppStore((state) => state.setWorkspaceTab);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex shrink-0 gap-1 border-b border-gray-200 bg-white px-5 dark:border-gray-800 dark:bg-gray-950">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setTab(tab.id)} className={`border-b-2 px-3 py-3 text-sm font-medium ${active === tab.id ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
