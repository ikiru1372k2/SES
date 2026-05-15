import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { WorkspaceTab } from '../../lib/domain/types';
import { isLegacyTileTrackingTabEnabled } from '../../lib/featureFlags';
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
  const tablistRef = useRef<HTMLDivElement | null>(null);

  // Notification + Tracking now live exclusively in the Escalation Center.
  const visibleTabs = tabs.filter((t) => {
    if (t.id === 'notifications') return false;
    if (t.id === 'tracking') return isLegacyTileTrackingTabEnabled();
    return true;
  });

  const activeIndex = Math.max(
    0,
    visibleTabs.findIndex((t) => t.id === active),
  );

  // WAI-ARIA tabs keyboard model: ←/→ move + activate, Home/End jump.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let next = activeIndex;
    if (e.key === 'ArrowRight') next = (activeIndex + 1) % visibleTabs.length;
    else if (e.key === 'ArrowLeft')
      next = (activeIndex - 1 + visibleTabs.length) % visibleTabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = visibleTabs.length - 1;
    else return;
    e.preventDefault();
    const target = visibleTabs[next];
    if (target) {
      setTab(target.id);
      tablistRef.current
        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        ?.[next]?.focus();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Workspace sections"
        onKeyDown={onKeyDown}
        className="flex shrink-0 gap-1 border-b border-gray-200 bg-white px-5 dark:border-gray-800 dark:bg-gray-950"
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
              className={`border-b-2 px-3 py-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset ${
                selected
                  ? 'border-brand font-semibold text-brand'
                  : 'border-transparent font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
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
