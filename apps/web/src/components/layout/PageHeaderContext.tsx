import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { HeaderAction, PageHeaderConfig } from './pageHeader.types';

// Shape = identity (labels, icons, order, callbacks). Changes rarely.
// Flags = per-action disabled/loading. Changes on every tick of a run.
// Splitting them lets the TopBar skeleton avoid re-rendering when only
// flags change, and lets individual action buttons subscribe to just
// their own flag slice via useHeaderFlag().

type ActionShape = Omit<HeaderAction, 'disabled' | 'loading'>;

export type HeaderShape = {
  breadcrumbs: PageHeaderConfig['breadcrumbs'];
  primary: ActionShape[];
  overflow: ActionShape[];
  showRealtime: boolean;
  showNotifications: boolean;
  leaveGuard: (() => boolean) | undefined;
};

export type HeaderFlags = Record<string, { disabled?: boolean | undefined; loading?: boolean | undefined }>;

const EMPTY_SHAPE: HeaderShape = {
  breadcrumbs: undefined,
  primary: [],
  overflow: [],
  showRealtime: true,
  showNotifications: true,
  leaveGuard: undefined,
};

const EMPTY_FLAGS: HeaderFlags = {};

const HeaderShapeContext = createContext<HeaderShape>(EMPTY_SHAPE);
const HeaderFlagsContext = createContext<HeaderFlags>(EMPTY_FLAGS);

type HeaderSetters = {
  setConfig: (config: PageHeaderConfig | null) => void;
};

const HeaderSettersContext = createContext<HeaderSetters>({ setConfig: () => {} });

function splitConfig(config: PageHeaderConfig | null): { shape: HeaderShape; flags: HeaderFlags } {
  if (!config) return { shape: EMPTY_SHAPE, flags: EMPTY_FLAGS };
  const extract = (a: HeaderAction): ActionShape => {
    const shape: ActionShape = { id: a.id, label: a.label, onClick: a.onClick };
    if (a.icon !== undefined) shape.icon = a.icon;
    if (a.shortcut !== undefined) shape.shortcut = a.shortcut;
    if (a.variant !== undefined) shape.variant = a.variant;
    if (a.splitMenu !== undefined) shape.splitMenu = a.splitMenu;
    if (a.tooltip !== undefined) shape.tooltip = a.tooltip;
    return shape;
  };
  const primary = (config.primaryActions ?? []).map(extract);
  const overflow = (config.overflowActions ?? []).map(extract);
  const flags: HeaderFlags = {};
  for (const a of [...(config.primaryActions ?? []), ...(config.overflowActions ?? [])]) {
    const flag: { disabled?: boolean | undefined; loading?: boolean | undefined } = {};
    if (a.disabled !== undefined) flag.disabled = a.disabled;
    if (a.loading !== undefined) flag.loading = a.loading;
    flags[a.id] = flag;
  }
  return {
    shape: {
      breadcrumbs: config.breadcrumbs,
      primary,
      overflow,
      showRealtime: config.showRealtime ?? true,
      showNotifications: config.showNotifications ?? true,
      leaveGuard: config.leaveGuard,
    },
    flags,
  };
}

// Cheap equality for HeaderShape. Compares ids, labels, variants, icon refs,
// callback refs, breadcrumb labels, and leave-guard reference. We intentionally
// do not walk splitMenu deeply — callers are expected to memoize it.
function shapeEqual(a: HeaderShape, b: HeaderShape): boolean {
  if (a === b) return true;
  if (a.showRealtime !== b.showRealtime) return false;
  if (a.showNotifications !== b.showNotifications) return false;
  if (a.leaveGuard !== b.leaveGuard) return false;
  const ac = a.breadcrumbs ?? [];
  const bc = b.breadcrumbs ?? [];
  if (ac.length !== bc.length) return false;
  for (let i = 0; i < ac.length; i++) {
    const ai = ac[i]!;
    const bi = bc[i]!;
    if (ai.label !== bi.label || ai.to !== bi.to) return false;
  }
  const lists: Array<[ActionShape[], ActionShape[]]> = [
    [a.primary, b.primary],
    [a.overflow, b.overflow],
  ];
  for (const [ax, bx] of lists) {
    if (ax.length !== bx.length) return false;
    for (let i = 0; i < ax.length; i++) {
      const x = ax[i]!;
      const y = bx[i]!;
      if (
        x.id !== y.id ||
        x.label !== y.label ||
        x.variant !== y.variant ||
        x.icon !== y.icon ||
        x.onClick !== y.onClick ||
        x.shortcut !== y.shortcut ||
        x.splitMenu !== y.splitMenu ||
        x.tooltip !== y.tooltip
      ) {
        return false;
      }
    }
  }
  return true;
}

function flagsEqual(a: HeaderFlags, b: HeaderFlags): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const x = a[k]!;
    const y = b[k];
    if (!y) return false;
    if ((x.disabled ?? false) !== (y.disabled ?? false)) return false;
    if ((x.loading ?? false) !== (y.loading ?? false)) return false;
  }
  return true;
}

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [shape, setShape] = useState<HeaderShape>(EMPTY_SHAPE);
  const [flags, setFlags] = useState<HeaderFlags>(EMPTY_FLAGS);

  const setConfig = useCallback((config: PageHeaderConfig | null) => {
    const next = splitConfig(config);
    setShape((prev) => (shapeEqual(prev, next.shape) ? prev : next.shape));
    setFlags((prev) => (flagsEqual(prev, next.flags) ? prev : next.flags));
  }, []);

  const setters = useMemo<HeaderSetters>(() => ({ setConfig }), [setConfig]);

  return (
    <HeaderSettersContext.Provider value={setters}>
      <HeaderShapeContext.Provider value={shape}>
        <HeaderFlagsContext.Provider value={flags}>{children}</HeaderFlagsContext.Provider>
      </HeaderShapeContext.Provider>
    </HeaderSettersContext.Provider>
  );
}

export function useHeaderShape(): HeaderShape {
  return useContext(HeaderShapeContext);
}

export function useHeaderFlag(id: string): { disabled?: boolean | undefined; loading?: boolean | undefined } {
  const flags = useContext(HeaderFlagsContext);
  return flags[id] ?? {};
}

export function useHeaderSetters(): HeaderSetters {
  return useContext(HeaderSettersContext);
}
