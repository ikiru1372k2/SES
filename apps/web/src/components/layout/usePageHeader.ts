import { useEffect, useRef } from 'react';
import type { PageHeaderConfig } from './pageHeader.types';
import { useHeaderSetters } from './PageHeaderContext';

export function usePageHeader(config: PageHeaderConfig): void {
  const { setConfig } = useHeaderSetters();

  if (import.meta.env.DEV) {
    if ((config.primaryActions?.length ?? 0) > 2) {
      throw new Error('usePageHeader: primaryActions exceeds the max of 2. Move overflow items to overflowActions.');
    }
    const seen = new Set<string>();
    for (const a of [...(config.primaryActions ?? []), ...(config.overflowActions ?? [])]) {
      if (!a.label) throw new Error(`usePageHeader: action "${a.id}" is missing a label.`);
      if (seen.has(a.id)) throw new Error(`usePageHeader: duplicate action id "${a.id}".`);
      seen.add(a.id);
    }
  }

  const prevClicksRef = useRef<Record<string, () => void>>({});

  useEffect(() => {
    if (import.meta.env.DEV) {
      const actions = [...(config.primaryActions ?? []), ...(config.overflowActions ?? [])];
      const next: Record<string, () => void> = {};
      for (const a of actions) {
        const prev = prevClicksRef.current[a.id];
        if (prev && prev !== a.onClick) {
          console.warn(
            `usePageHeader: onClick for action "${a.id}" is a new reference every render. Wrap it in useCallback to avoid unnecessary header re-renders.`,
          );
        }
        next[a.id] = a.onClick;
      }
      prevClicksRef.current = next;
    }
    setConfig(config);
    return () => setConfig(null);
  }, [config, setConfig]);
}
