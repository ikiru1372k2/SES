/**
 * F7: attach the CSRF marker header to every same-origin API request.
 *
 * The API enforces a global CsrfGuard that requires `X-Requested-With: ses`
 * on cookie-authenticated state-changing requests. Rather than touch ~30
 * scattered fetch() call sites, we wrap the global fetch ONCE here and add
 * the header for same-origin requests only. Cross-origin requests (none
 * today, but defensively) are left untouched so we never leak the marker
 * or break third-party CORS.
 *
 * Idempotent: safe if imported more than once (guards via a symbol flag).
 */
const INSTALLED = Symbol.for('ses.csrfFetchInstalled');

function isSameOrigin(input: RequestInfo | URL): boolean {
  try {
    const url =
      typeof input === 'string'
        ? new URL(input, window.location.origin)
        : input instanceof URL
          ? input
          : new URL((input as Request).url, window.location.origin);
    return url.origin === window.location.origin;
  } catch {
    // Relative string that failed to parse → treat as same-origin.
    return true;
  }
}

export function installCsrfHeader(): void {
  const g = globalThis as typeof globalThis & { [INSTALLED]?: boolean };
  if (g[INSTALLED] || typeof g.fetch !== 'function') {
    return;
  }
  const originalFetch = g.fetch.bind(g);

  g.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isSameOrigin(input)) {
      return originalFetch(input, init);
    }
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has('X-Requested-With')) {
      headers.set('X-Requested-With', 'ses');
    }
    return originalFetch(input, { ...init, headers });
  };

  g[INSTALLED] = true;
}
