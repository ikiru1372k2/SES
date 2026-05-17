import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'ses-sidebar-collapsed';

function readInitial(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

type SidebarCollapsedContextValue = {
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
  toggle: () => void;
};

const SidebarCollapsedContext = createContext<SidebarCollapsedContextValue | null>(null);

export function SidebarCollapsedProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<boolean>(readInitial);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // localStorage may be unavailable — in-memory state still works.
    }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((value) => !value), []);

  const value = useMemo(
    () => ({ collapsed, setCollapsed, toggle }),
    [collapsed, toggle],
  );

  return createElement(SidebarCollapsedContext.Provider, { value }, children);
}

function useSidebarCollapsedContext(): SidebarCollapsedContextValue {
  const ctx = useContext(SidebarCollapsedContext);
  if (ctx) return ctx;

  const [collapsed, setCollapsed] = useState(false);
  const toggle = useCallback(() => setCollapsed((value) => !value), []);
  return { collapsed, setCollapsed, toggle };
}

export function useSidebarCollapsed(): [boolean, (next: boolean) => void, () => void] {
  const { collapsed, setCollapsed, toggle } = useSidebarCollapsedContext();
  return [collapsed, setCollapsed, toggle];
}
