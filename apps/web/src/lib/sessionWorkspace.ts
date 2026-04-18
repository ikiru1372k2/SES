import { clearBrowserWorkspace } from './storage';
import { useAppStore } from '../store/useAppStore';

const BOUND_KEY = 'ses_workspace_bound_email';

export function applySessionUserForLocalWorkspace(email: string): void {
  if (typeof window === 'undefined') return;
  const prev = sessionStorage.getItem(BOUND_KEY);
  if (prev === email) {
    return;
  }
  if (prev !== null) {
    clearBrowserWorkspace();
    useAppStore.getState().resetWorkspaceAfterUserSwitch();
  }
  sessionStorage.setItem(BOUND_KEY, email);
}
