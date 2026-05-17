import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { WorkspaceTab } from '../../lib/domain/types';
import { isLegacyTileTrackingTabEnabled } from '../../lib/featureFlags';
import { useAppStore } from '../../store/useAppStore';

const baseTabs: { id: WorkspaceTab; label: string }[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'results', label: 'Issues' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'versions', label: 'Versions' },
];

export function WorkspaceShell({
  children,
  issueCount,
  versionCount,
}: {
  children: ReactNode;
  issueCount?: number;
  versionCount?: number;
}) {
  const active = useAppStore((state) => state.activeWorkspaceTab);
  const setTab = useAppStore((state) => state.setWorkspaceTab);
  const tablistRef = useRef<HTMLDivElement | null>(null);

  const visibleTabs = baseTabs.filter((t) => {
    if (t.id === 'notifications') return false;
    if (t.id === 'tracking') return isLegacyTileTrackingTabEnabled();
    return true;
  });

  function tabLabel(tab: (typeof baseTabs)[number]): string {
    if (tab.id === 'results' && issueCount != null && issueCount > 0) return `Issues · ${issueCount}`;
    if (tab.id === 'versions' && versionCount != null && versionCount > 0) return `Versions · ${versionCount}`;
    if (tab.id === 'results') return 'Issues';
    if (tab.id === 'versions') return 'Versions';
    return tab.label;
  }

  const activeIndex = Math.max(
    0,
    visibleTabs.findIndex((t) => t.id === active),
  );

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let next = activeIndex;
    if (e.key === 'ArrowRight') next = (activeIndex + 1) % visibleTabs.length;
    else if (e.key === 'ArrowLeft') next = (activeIndex - 1 + visibleTabs.length) % visibleTabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = visibleTabs.length - 1;
    else return;
    e.preventDefault();
    const target = visibleTabs[next];
    if (target) {
      setTab(target.id);
      tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')?.[next]?.focus();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Workspace sections"
        onKeyDown={onKeyDown}
        className="flex shrink-0 gap-0.5 border-b border-rule bg-white px-4 dark:border-gray-800 dark:bg-gray-950 sm:px-5"
      >
        {visibleTabs.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              id={`ws-tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls="ws-tabpanel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(tab.id)}
              className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition-colors ease-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset ${
                selected
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink-2 hover:text-ink dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {tabLabel(tab)}
            </button>
          );
        })}
      </div>
      <div
        id="ws-tabpanel"
        role="tabpanel"
        aria-labelledby={`ws-tab-${active}`}
        tabIndex={0}
        className="flex min-h-0 flex-1 flex-col overflow-hidden focus:outline-none"
      >
        {children}
      </div>
    </div>
  );
}
