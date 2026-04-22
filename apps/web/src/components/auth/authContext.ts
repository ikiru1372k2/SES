import { createContext, useContext } from 'react';

export interface SessionUserInfo {
  displayCode: string;
  displayName: string;
  email: string;
  role: 'admin' | 'auditor' | 'viewer';
}

export const CurrentUserContext = createContext<SessionUserInfo | null>(null);

export function useCurrentUser(): SessionUserInfo | null {
  return useContext(CurrentUserContext);
}

/** Non-null variant for code paths that are only mounted inside AuthGate. */
export function useCurrentUserOrThrow(): SessionUserInfo {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error('useCurrentUserOrThrow called outside AuthGate');
  return user;
}
