import { FileText, PanelLeftOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { SidebarCollapsedProvider, useSidebarCollapsed } from '../../hooks/useSidebarCollapsed';
import type { AuditProcess } from '../../lib/domain/types';
import { useAppStore } from '../../store/useAppStore';
import { GlobalShortcutOverlay } from '../shared/GlobalShortcutOverlay';
import { ProgressBar } from '../shared/ProgressBar';
import { TopBar } from './TopBar';

export function AppShell({
  process,
  sidebar,
  topBarAccessory,
  contentScrolls = true,
  children,
}: {
  process?: AuditProcess | undefined;
  sidebar?: ReactNode;
  topBarAccessory?: ReactNode;
  contentScrolls?: boolean;
  children: ReactNode;
}) {
  const isAuditRunning = useAppStore((state) => state.isAuditRunning);
  const progressText = useAppStore((state) => state.auditProgressText);
  const cancelAudit = useAppStore((state) => state.cancelAudit);
  const documentCount = process ? process.files.length || process.serverFilesCount || 0 : 0;
  return (
    <div className="flex h-full flex-col bg-surface-app text-gray-950 dark:bg-gray-950 dark:text-white">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <TopBar process={process} accessory={topBarAccessory} />
      {isAuditRunning ? (
        <>
          <div className="flex items-center gap-3 border-b border-rule bg-surface-app px-4 py-2 text-xs text-ink-2 dark:border-gray-800 dark:bg-gray-950/80 sm:px-5">
            <span className="font-semibold text-ink dark:text-gray-200">Running audit</span>
            <span className="truncate text-ink-3">{progressText}</span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={cancelAudit}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-ink-2 hover:bg-white hover:text-ink dark:hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
          <div className="border-b border-rule bg-surface-app px-4 pb-2 dark:border-gray-800 sm:px-5">
            <ProgressBar value={0} indeterminate />
          </div>
        </>
      ) : null}
      <div className="flex min-h-0 flex-1">
                {sidebar ? (
          <SidebarCollapsedProvider>
            <WorkspaceDocumentsSidebar documentCount={documentCount}>{sidebar}</WorkspaceDocumentsSidebar>
          </SidebarCollapsedProvider>
        ) : null}
        <main
          id="main-content"
          tabIndex={-1}
          className={`flex min-w-0 flex-1 flex-col focus:outline-none ${sidebar || !contentScrolls ? 'overflow-hidden' : 'overflow-y-auto'}`}
        >
          {children}
        </main>
      </div>
      <GlobalShortcutOverlay />
    </div>
  );
}

function WorkspaceDocumentsSidebar({
  documentCount,
  children,
}: {
  documentCount: number;
  children: ReactNode;
}) {
  const [collapsed, , toggle] = useSidebarCollapsed();

  if (collapsed) {
    return (
      <aside className="hidden h-full w-12 shrink-0 flex-col items-center gap-3 border-r border-rule border-t-2 border-t-brand bg-white py-3 md:flex dark:border-gray-800 dark:bg-gray-950">
        <button
          type="button"
          onClick={toggle}
          aria-label="Expand documents sidebar"
          title="Expand documents sidebar"
          className="rounded-md p-1.5 text-ink-3 hover:bg-surface-app hover:text-ink dark:hover:bg-gray-800"
        >
          <PanelLeftOpen size={18} />
        </button>
        <div className="flex flex-col items-center gap-1 text-[10px] text-ink-3">
          <FileText size={16} aria-hidden />
          <span aria-label={`${documentCount} documents`}>{documentCount}</span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden h-full w-[240px] shrink-0 flex-col border-r border-rule border-t-2 border-t-brand bg-white md:flex dark:border-gray-800 dark:bg-gray-950">
      {/* Children own their own scroll: FilesSidebar pins the dropzone footer
          and scrolls the Documents/Sheets sections internally. */}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}
