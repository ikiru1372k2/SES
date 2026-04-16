import type { ReactNode } from 'react';
import type { AuditProcess } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { ProgressBar } from '../shared/ProgressBar';
import { TopBar } from './TopBar';

export function AppShell({ process, sidebar, children }: { process?: AuditProcess | undefined; sidebar?: ReactNode; children: ReactNode }) {
  const isAuditRunning = useAppStore((state) => state.isAuditRunning);
  const progressText = useAppStore((state) => state.auditProgressText);
  return (
    <div className="flex h-full flex-col bg-[#f6f6f4] text-gray-950 dark:bg-gray-950 dark:text-white">
      <TopBar process={process} />
      {isAuditRunning ? (
        <div className="border-b border-gray-200 bg-white px-5 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
          <div className="mb-1">{progressText}</div>
          <ProgressBar value={60} />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {sidebar ? <aside className="h-full w-[260px] shrink-0 overflow-y-auto border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">{sidebar}</aside> : null}
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
