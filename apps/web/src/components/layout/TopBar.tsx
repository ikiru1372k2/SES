import type { ReactNode } from 'react';
import { isNewHeaderEnabled } from '../../lib/featureFlags';
import type { AuditProcess } from '../../lib/types';
import { TopBarLegacy } from './TopBarLegacy';
import { TopBarNew } from './TopBarNew';

export function TopBar({
  process,
  accessory,
  sidebarToggle,
}: {
  process?: AuditProcess | undefined;
  accessory?: ReactNode;
  sidebarToggle?: ReactNode;
}) {
  if (isNewHeaderEnabled()) {
    return <TopBarNew sidebarToggle={sidebarToggle} />;
  }
  return <TopBarLegacy process={process} accessory={accessory} />;
}
