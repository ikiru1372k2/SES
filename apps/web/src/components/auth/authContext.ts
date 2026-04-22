import { createContext, useContext } from 'react';
import type { SessionUser } from '@ses/domain';

export type SessionUserInfo = SessionUser;

export const CurrentUserContext = createContext<SessionUserInfo | null>(null);

export function useCurrentUser(): SessionUserInfo | null {
  return useContext(CurrentUserContext);
}

export function useCurrentUserOrThrow(): SessionUserInfo {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error('useCurrentUserOrThrow called outside AuthGate');
  return user;
}
