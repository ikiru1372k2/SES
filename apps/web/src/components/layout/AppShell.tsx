import { FileText, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSidebarCollapsed } from '../../hooks/useSidebarCollapsed';
import type { AuditProcess } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { ProgressBar } from '../shared/ProgressBar';
import { TopBar } from './TopBar';

export function AppShell({ process, sidebar, children }: { process?: AuditProcess | undefined; sidebar?: ReactNode; children: ReactNode }) {
  const isAuditRunning = useAppStore((state) => state.isAuditRunning);
  const progressText = useAppStore((state) => state.auditProgressText);
  const [collapsed, , toggle] = useSidebarCollapsed();
  const documentCount = process?.files.length ?? 0;
  return (
    <div className="flex h-full flex-col bg-slate-50 text-gray-950 dark:bg-gray-950 dark:text-white">
      <TopBar process={process} />
      {isAuditRunning ? (
        <div className="border-b border-gray-200 bg-white px-5 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
          <div className="mb-1">{progressText}</div>
          <ProgressBar value={0} indeterminate />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {sidebar ? (
          collapsed ? (
            <aside className="flex h-full w-12 shrink-0 flex-col items-center gap-3 border-r border-gray-200 bg-white py-3 dark:border-gray-800 dark:bg-gray-950">
              <button
                type="button"
                onClick={toggle}
                aria-label="Expand documents sidebar"
                title="Expand documents sidebar"
                className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              >
                <PanelLeftOpen size={18} />
              </button>
              <div className="flex flex-col items-center gap-1 text-[10px] text-gray-400">
                <FileText size={16} />
                <span aria-label={`${documentCount} documents`}>{documentCount}</span>
              </div>
            </aside>
          ) : (
            <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
              <div className="flex items-center justify-end border-b border-gray-100 px-2 py-1 dark:border-gray-800">
                <button
                  type="button"
                  onClick={toggle}
                  aria-label="Collapse documents sidebar"
                  title="Collapse documents sidebar"
                  className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                >
                  <PanelLeftClose size={16} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">{sidebar}</div>
            </aside>
          )
        ) : null}
        <main className={`flex min-w-0 flex-1 flex-col ${sidebar ? 'overflow-hidden' : 'overflow-y-auto'}`}>{children}</main>
      </div>
    </div>
  );
}
