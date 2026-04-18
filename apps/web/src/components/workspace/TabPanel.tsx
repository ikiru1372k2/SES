import type { ReactNode } from 'react';

type TabPanelProps = {
  children: ReactNode;
  /**
   * Scroll behavior:
   * - 'single' (default): one scroll container with padding for simple tabs.
   * - 'split': no wrapper, caller manages its own multi-panel scroll regions.
   */
  scroll?: 'single' | 'split';
  className?: string;
};

export function TabPanel({ children, scroll = 'single', className = '' }: TabPanelProps) {
  if (scroll === 'split') {
    return <div className={`flex min-h-0 flex-1 ${className}`}>{children}</div>;
  }
  return <div className={`min-h-0 flex-1 overflow-y-auto p-5 ${className}`}>{children}</div>;
}
