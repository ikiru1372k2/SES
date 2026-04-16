import { useEffect } from 'react';

export function useKeyboardShortcut(key: string, handler: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
      if (isTyping || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() !== key.toLowerCase()) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, handler, key]);
}
