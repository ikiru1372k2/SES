import type { LucideIcon } from 'lucide-react';

export type Crumb = {
  label: string;
  to?: string | undefined;
};

export type HeaderActionVariant = 'primary' | 'secondary' | 'danger';

export type HeaderSplitItem = {
  label: string;
  description?: string | undefined;
  onClick: () => void;
  disabled?: boolean | undefined;
};

export type HeaderAction = {
  id: string;
  label: string;
  icon?: LucideIcon | undefined;
  onClick: () => void;
  shortcut?: string | undefined;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  variant?: HeaderActionVariant | undefined;
  splitMenu?: HeaderSplitItem[] | undefined;
  tooltip?: string | undefined;
};

export interface PageHeaderConfig {
  breadcrumbs?: Crumb[] | undefined;
  primaryActions?: HeaderAction[] | undefined;
  overflowActions?: HeaderAction[] | undefined;
  showRealtime?: boolean | undefined;
  showNotifications?: boolean | undefined;
  leaveGuard?: (() => boolean) | undefined;
}

export const Z = {
  header: 40,
  headerPopover: 45,
  modal: 50,
  toast: 80,
  debug: 95,
} as const;
