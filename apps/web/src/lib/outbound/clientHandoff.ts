/**
 * Issue #75: server-side SMTP and Teams webhooks were removed. The auditor's
 * own mail / Teams app performs the actual send after the server records intent.
 *
 * Browser popup-blocker rule: window.open() is only allowed synchronously
 * inside a user-gesture handler (click). Calling it inside a then/async
 * callback after a fetch silently fails. The pattern here is:
 *   1. Open a blank window SYNCHRONOUSLY on click → bypasses blocker.
 *   2. After the server responds, write content into that window.
 *   3. The content auto-fires the mailto: / Teams deep-link so the user's
 *      app opens immediately, AND shows the formatted preview so they can
 *      paste the rich body into their compose window.
 */

export interface MailtoHandoff {
  to: string;
  cc?: string[] | undefined;
  subject: string;
  body: string;
  /** Full HTML rendering of the email — same as Compose preview. */
  bodyHtml?: string | undefined;
}

export interface TeamsHandoff {
  to: string;
  message: string;
}

/** Build a mailto: URL using encodeURIComponent (spaces → %20, not +). */
function buildMailtoUrl(opts: Pick<MailtoHandoff, 'to' | 'cc' | 'subject' | 'body'>): string {
  const parts: string[] = [
    `subject=${encodeURIComponent(opts.subject)}`,
    `body=${encodeURIComponent(opts.body)}`,
  ];
  if (opts.cc && opts.cc.length > 0) {
    parts.push(`cc=${encodeURIComponent(opts.cc.join(','))}`);
  }
  return `mailto:${encodeURIComponent(opts.to)}?${parts.join('&')}`;
}

/** Open a blank window synchronously (call this inside a click handler). */
export function openBlankWindow(): Window | null {
  return window.open('', '_blank', 'width=960,height=740,resizable=yes,scrollbars=yes');
}

export function openEmailClient(win: Window | null, opts: MailtoHandoff): void {
  const mailtoUrl = buildMailtoUrl(opts);
  if (win && !win.closed) {
    win.location.href = mailtoUrl;
    window.setTimeout(() => {
      if (!win.closed) win.close();
    }, 1000);
    return;
  }
  window.location.href = mailtoUrl;
}

export function fillEmailPreviewWindow(win: Window, opts: MailtoHandoff): void {
  const { to, cc = [], subject, body, bodyHtml } = opts;

  const safeHtml = (bodyHtml ?? '').replace(/<\/script>/gi, '<\\/script>');
  const safePlain = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeSubject = subject.replace(/</g, '&lt;');
  const safeTo = to.replace(/</g, '&lt;');
  const safeCc = cc.join(', ').replace(/</g, '&lt;');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeSubject}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;padding:24px}
.card{background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.12);max-width:860px;margin:0 auto;overflow:hidden}
.bar{background:#1e293b;color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.bar-title{font-size:13px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;border:none;white-space:nowrap}
.btn-ghost{background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.28)}.btn-ghost:hover{background:rgba(255,255,255,.24)}
.ok{background:#059669!important;border-color:#059669!important}
.hint{font-size:12px;color:rgba(255,255,255,.65);flex-basis:100%;padding-top:4px}
.meta{padding:14px 20px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;display:grid;gap:4px}
.mrow{display:flex;gap:8px}
.mlabel{font-weight:600;min-width:64px;flex-shrink:0;color:#6b7280}
.body{padding:24px}
</style>
</head>
<body>
<div class="card">
  <div class="bar">
    <span class="bar-title">${safeSubject}</span>
    <button id="cb" class="btn btn-ghost" onclick="copyBody()">Copy body</button>
    <span class="hint">Preview only. This does not record a send or open Outlook.</span>
  </div>
  <div class="meta">
    <div class="mrow"><span class="mlabel">To:</span><span>${safeTo}</span></div>
    ${safeCc ? `<div class="mrow"><span class="mlabel">CC:</span><span>${safeCc}</span></div>` : ''}
    <div class="mrow"><span class="mlabel">Subject:</span><span>${safeSubject}</span></div>
  </div>
  <div class="body" id="eb">
    ${bodyHtml ? safeHtml : `<pre style="white-space:pre-wrap;font-size:13px;font-family:inherit;color:#111827;line-height:1.6">${safePlain}</pre>`}
  </div>
</div>
<script>
function copyBody() {
  var btn = document.getElementById('cb');
  var el = document.getElementById('eb');
  function done(t) { btn.textContent = t; btn.classList.add('ok'); setTimeout(function(){ btn.textContent = 'Copy body'; btn.classList.remove('ok'); }, 2200); }
  if (navigator.clipboard && window.ClipboardItem) {
    navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([el.innerHTML], {type:'text/html'}),
      'text/plain': new Blob([el.innerText], {type:'text/plain'})
    })]).then(function(){ done('Copied!'); }).catch(function(){
      navigator.clipboard.writeText(el.innerText).then(function(){ done('Copied (plain)'); });
    });
  } else {
    var r = document.createRange(); r.selectNodeContents(el);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    document.execCommand('copy'); s.removeAllRanges();
    done('Copied!');
  }
}
</script>
</body>
</html>`;

  win.document.write(html);
  win.document.close();
}

/**
 * Write the email handoff page into an already-open window.
 * - Auto-fires the mailto: so Outlook opens immediately.
 * - Shows the rich HTML preview so the user can copy-paste the body.
 * - "Copy body" copies the HTML as rich text to clipboard.
 */
export function fillEmailWindow(win: Window, opts: MailtoHandoff): void {
  const { to, cc = [], subject, body, bodyHtml } = opts;
  const mailtoUrl = buildMailtoUrl({ to, cc, subject, body });
  const safePlain = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const safeMailto = mailtoUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeHtml = (bodyHtml ?? '').replace(/<\/script>/gi, '<\\/script>');
  const safeSubject = subject.replace(/</g, '&lt;');
  const safeTo = to.replace(/</g, '&lt;');
  const safeCc = cc.join(', ').replace(/</g, '&lt;');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeSubject}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;padding:24px}
.card{background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.12);max-width:860px;margin:0 auto;overflow:hidden}
.bar{background:#1e293b;color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.bar-title{font-size:13px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.75}
.btns{display:flex;gap:8px;flex-shrink:0}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;border:none;text-decoration:none;white-space:nowrap}
.btn-blue{background:#2563eb;color:#fff}.btn-blue:hover{background:#1d4ed8}
.btn-ghost{background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.28)}.btn-ghost:hover{background:rgba(255,255,255,.24)}
.ok{background:#059669!important;border-color:#059669!important}
.hint{font-size:12px;color:rgba(255,255,255,.6);flex-basis:100%;padding-top:4px}
.meta{padding:14px 20px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;display:grid;gap:4px}
.mrow{display:flex;gap:8px}
.mlabel{font-weight:600;min-width:64px;flex-shrink:0;color:#6b7280}
.body{padding:24px}
</style>
</head>
<body>
<div class="card">
  <div class="bar">
    <span class="bar-title">📧 ${safeSubject}</span>
    <div class="btns">
      <a class="btn btn-blue" href="${safeMailto}">Open in Outlook ↗</a>
    </div>
    <span class="hint">Outlook opens with To, Subject and the formatted plain-text table prefilled.</span>
  </div>
  <div class="meta">
    <div class="mrow"><span class="mlabel">To:</span><span>${safeTo}</span></div>
    ${safeCc ? `<div class="mrow"><span class="mlabel">CC:</span><span>${safeCc}</span></div>` : ''}
    <div class="mrow"><span class="mlabel">Subject:</span><span>${safeSubject}</span></div>
  </div>
  <div class="body" id="eb">
    ${bodyHtml ? safeHtml : `<pre style="white-space:pre-wrap;font-size:13px;font-family:inherit;color:#111827;line-height:1.6">${safePlain}</pre>`}
  </div>
</div>
<script>
window.location.href = '${safeMailto}';
</script>
</body>
</html>`;

  win.document.write(html);
  win.document.close();
}

/** Write a loading spinner into an already-open window while waiting for the server. */
export function fillLoadingWindow(win: Window): void {
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Loading…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f3f4f6;color:#374151}
.spinner{width:36px;height:36px;border:3px solid #e5e7eb;border-top-color:#2563eb;border-radius:50%;animation:spin .7s linear infinite;margin-bottom:16px}
@keyframes spin{to{transform:rotate(360deg)}}
.wrap{display:flex;flex-direction:column;align-items:center;gap:8px}
p{font-size:14px;font-weight:500}
</style></head><body><div class="wrap"><div class="spinner"></div><p>Recording send…</p></div></body></html>`);
  win.document.close();
}

/**
 * Opens Teams (desktop if installed, otherwise web) on the 1:1 chat.
 * Teams deep-links must be opened synchronously — call this inside the
 * click handler, not in an async callback.
 * Body is capped at 4 KB (Teams documented limit).
 */
export function openTeamsChat(opts: TeamsHandoff): boolean {
  const message = opts.message.length > 4000 ? opts.message.slice(0, 4000) : opts.message;
  const url =
    `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(opts.to)}` +
    `&message=${encodeURIComponent(message)}`;
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  return Boolean(w);
}
