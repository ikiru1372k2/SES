/**
 * Issue #75: server-side SMTP and Teams webhooks were removed. The auditor's
 * own mail / Teams app performs the actual send after the server records
 * intent, so replies thread back to the auditor and no outbound config is
 * needed on the API.
 *
 * Keep these helpers tiny and self-contained — they're the full surface
 * the Composer and BroadcastDialog rely on for delivery.
 */

export interface MailtoHandoff {
  to: string;
  cc?: string[];
  subject: string;
  body: string;
}

export interface TeamsHandoff {
  to: string; // recipient's email (Teams accepts email as a user identifier)
  message: string;
}

const WINDOW_FEATURES = 'noopener,noreferrer';

/**
 * Opens the user's default mail client with subject / body / cc prefilled.
 * Returns `true` if the window.open was accepted, `false` if the browser's
 * popup blocker silently swallowed it — the caller can fall back to a
 * copy-to-clipboard flow when that happens.
 */
export function openMailto(opts: MailtoHandoff): boolean {
  const qs = new URLSearchParams();
  qs.set('subject', opts.subject);
  qs.set('body', opts.body);
  if (opts.cc && opts.cc.length > 0) qs.set('cc', opts.cc.join(','));
  const url = `mailto:${encodeURIComponent(opts.to)}?${qs.toString()}`;
  const w = window.open(url, '_blank', WINDOW_FEATURES);
  return Boolean(w);
}

/**
 * Opens Teams (desktop if installed, otherwise web) on the 1:1 chat with
 * the supplied user, prefilled with the message body. Teams truncates long
 * deep-links silently; body is capped at 4 KB to stay safely inside the
 * documented limit.
 */
export function openTeamsChat(opts: TeamsHandoff): boolean {
  const message = opts.message.length > 4000 ? opts.message.slice(0, 4000) : opts.message;
  const url =
    `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(opts.to)}` +
    `&message=${encodeURIComponent(message)}`;
  const w = window.open(url, '_blank', WINDOW_FEATURES);
  return Boolean(w);
}
