export const DEBUG_LOG_KEY = 'ses-debug-events';

export type DebugEvent = {
  id: string;
  at: string;
  message: string;
  stack?: string;
  componentStack?: string;
  userAgent: string;
  path: string;
};

export function readDebugEvents(): DebugEvent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEBUG_LOG_KEY) || '[]');
    return Array.isArray(parsed) ? parsed as DebugEvent[] : [];
  } catch {
    return [];
  }
}

export function recordDebugEvent(event: Omit<DebugEvent, 'id' | 'at' | 'userAgent' | 'path'>): void {
  const next: DebugEvent = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
    at: new Date().toISOString(),
    userAgent: navigator.userAgent,
    path: window.location.href,
    ...event,
  };
  localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify([next, ...readDebugEvents()].slice(0, 20)));
}

export function clearDebugEvents(): void {
  localStorage.removeItem(DEBUG_LOG_KEY);
}
