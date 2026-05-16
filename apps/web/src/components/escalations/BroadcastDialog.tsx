import { useEffect, useRef, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Eye, Megaphone, Send } from 'lucide-react';
import {
  broadcastNotification,
  type BroadcastOutcome,
  type BroadcastRecipient,
} from '../../lib/api/bulkTrackingApi';
import { fillLoadingWindow, openBlankWindow } from '../../lib/outbound/clientHandoff';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { PreviewPane } from './PreviewPane';

type Channel = 'email' | 'teams';

function addBusinessDays(base: Date, days: number): Date {
  const d = new Date(base);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) added += 1;
  }
  return d;
}

function toDateInputValue(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function BroadcastDialog({
  processIdOrCode,
  open,
  onClose,
  onDone,
  estimatedAudience,
  functionOptions = [],
}: {
  processIdOrCode: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  estimatedAudience: number;
  functionOptions?: Array<{ id: string; label: string }>;
}) {
  const [editMode, setEditMode] = useState(false);
  const [subject, setSubject] = useState('Action required: open findings for your review');
  const [body, setBody] = useState(
    'Dear colleague,\n\nWe have noticed that you have open audit findings that require your attention. Please review and update your records by {{dueDate}}.\n\nIf you have any questions, please reply to this email.\n\nThank you.',
  );
  const [channel, setChannel] = useState<Channel>('email');
  const [functionId, setFunctionId] = useState<string>('');
  const [deadlineAt, setDeadlineAt] = useState<string>(() =>
    toDateInputValue(addBusinessDays(new Date(), 5)),
  );
  const [busy, setBusy] = useState(false);

  // Window opened synchronously on Send click — filled after fetch completes.
  const handoffWinRef = useRef<Window | null>(null);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setEditMode(false);
  }, [open]);

  /** Build the plain-text body for preview substitution. */
  const resolvePreview = (src: string) =>
    src
      .replace(/\{\{managerName\}\}/g, 'Hassan, Farah')
      .replace(/\{\{projectCount\}\}/g, String(estimatedAudience > 0 ? 3 : 0))
      .replace(/\{\{dueDate\}\}/g, deadlineAt ? new Date(deadlineAt).toLocaleDateString() : '—')
      .replace(/\{\{auditRunCode\}\}/g, 'RUN-…');

  /**
   * After the server records intent, open ONE Outlook window with:
   *  - To:  first manager (required by mailto spec)
   *  - BCC: all remaining managers
   *  - Subject + body: the global message
   *
   * For Teams: open one chat window per manager (Teams has no group DM API).
   */
  function openHandoff(outcome: BroadcastOutcome, win: Window | null) {
    const sent = outcome.recipients.filter(
      (r): r is Extract<BroadcastRecipient, { state: 'sent' }> => r.state === 'sent',
    );
    if (sent.length === 0) {
      if (win && !win.closed) win.close();
      return;
    }

    if (channel === 'teams') {
      const links = sent.map((r, i) => {
        const msg = `${r.subject}\n\n${r.body}`;
        const url =
          `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(r.managerEmail)}` +
          `&message=${encodeURIComponent(msg.length > 4000 ? msg.slice(0, 4000) : msg)}`;
        return `<li><a href="${url}" target="_blank" rel="noreferrer">Open Teams for ${i + 1}. ${r.managerName}</a></li>`;
      }).join('');
      if (win && !win.closed) {
        win.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Teams broadcast handoff</title>
<style>body{font-family:system-ui,sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#111827}.card{max-width:760px;margin:0 auto;background:white;border:1px solid #e5e7eb;border-radius:8px;padding:18px}h1{font-size:20px;margin:0 0 6px}p{font-size:13px;color:#4b5563}li{margin:10px 0}a{color:#2563eb;font-weight:600}</style></head><body><main class="card"><h1>Teams broadcast handoff</h1><p>Open each Teams chat from this page. Browser popup blockers will not block links you click manually.</p><ol>${links}</ol></main></body></html>`);
        win.document.close();
      }
      return;
    }

    // Email: one Outlook window — To = first, BCC = rest (broadcasts share subject/body).
    const first = sent[0]!;
    const bcc = sent.slice(1).map((r) => r.managerEmail);
    const parts = [
      `subject=${encodeURIComponent(first.subject)}`,
      `body=${encodeURIComponent(first.body)}`,
    ];
    if (bcc.length > 0) parts.push(`bcc=${encodeURIComponent(bcc.join(';'))}`);
    const mailtoUrl = `mailto:${encodeURIComponent(first.managerEmail)}?${parts.join('&')}`;

    const safeMailto = mailtoUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const safeBody = first.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeSubject = first.subject.replace(/</g, '&lt;');
    const toList = sent.map((r) => `${r.managerName} &lt;${r.managerEmail}&gt;`).join('<br>');

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${safeSubject}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;padding:24px}
.card{background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.12);max-width:860px;margin:0 auto;overflow:hidden}
.bar{background:#1e293b;color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.bar-title{font-size:13px;font-weight:600;flex:1}
.btns{display:flex;gap:8px;flex-shrink:0}
.btn{display:inline-flex;align-items:center;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;border:none;text-decoration:none}
.btn-blue{background:#2563eb;color:#fff}.btn-blue:hover{background:#1d4ed8}
.btn-ghost{background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.28)}.btn-ghost:hover{background:rgba(255,255,255,.24)}
.ok{background:#059669!important;border-color:#059669!important}
.hint{font-size:11px;color:rgba(255,255,255,.6);flex-basis:100%;padding-top:4px}
.meta{padding:14px 20px;border-bottom:1px solid #e5e7eb;font-size:13px;display:grid;gap:6px}
.mrow{display:flex;gap:8px;align-items:baseline}
.ml{font-weight:600;min-width:72px;flex-shrink:0;color:#6b7280;font-size:12px}
.recipients-toggle{font-size:11px;color:#2563eb;cursor:pointer;margin-left:4px}
.recipients-list{margin-top:4px;font-size:11px;color:#374151;line-height:1.8;display:none}
.body{padding:24px}
pre{white-space:pre-wrap;font-family:inherit;font-size:13px;line-height:1.7;color:#111827}
</style>
</head>
<body>
<div class="card">
  <div class="bar">
    <span class="bar-title">📧 Broadcast — ${sent.length} recipient${sent.length === 1 ? '' : 's'}</span>
    <div class="btns">
      <button id="cb" class="btn btn-ghost" onclick="copyBody()">Copy body</button>
      <a class="btn btn-blue" href="${safeMailto}">Open in Outlook ↗</a>
    </div>
    <span class="hint">Outlook opens with all managers pre-filled. This records the broadcast handoff; send the draft in Outlook to complete delivery.</span>
  </div>
  <div class="meta">
    <div class="mrow">
      <span class="ml">To:</span>
      <span>${first.managerName} &lt;${first.managerEmail}&gt;
        ${sent.length > 1 ? `<span class="recipients-toggle" onclick="toggleList()">(+${sent.length - 1} more)</span>` : ''}
      </span>
    </div>
    ${bcc.length > 0 ? `<div class="mrow"><span class="ml">BCC:</span><span id="recList" class="recipients-list">${toList}</span><span id="recCount" style="font-size:12px;color:#374151">${bcc.length} others in BCC</span></div>` : ''}
    <div class="mrow"><span class="ml">Subject:</span><span>${safeSubject}</span></div>
  </div>
  <div class="body" id="eb"><pre>${safeBody}</pre></div>
</div>
<script>
window.location.href = '${safeMailto}';
function toggleList(){
  var l=document.getElementById('recList'),c=document.getElementById('recCount');
  if(!l||!c)return;
  var shown=l.style.display==='block';
  l.style.display=shown?'none':'block';
  c.style.display=shown?'':'none';
}
function copyBody(){
  var btn=document.getElementById('cb'),el=document.getElementById('eb');
  function done(t){btn.textContent=t;btn.classList.add('ok');setTimeout(function(){btn.textContent='Copy body';btn.classList.remove('ok');},2200);}
  if(navigator.clipboard&&window.ClipboardItem){
    navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([el.innerHTML],{type:'text/html'}),'text/plain':new Blob([el.innerText],{type:'text/plain'})})]).then(function(){done('Copied!');}).catch(function(){navigator.clipboard.writeText(el.innerText).then(function(){done('Copied (plain)');});});
  } else {
    var r=document.createRange();r.selectNodeContents(el);var s=window.getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('copy');s.removeAllRanges();done('Copied!');
  }
}
</script>
</body></html>`;

    if (win && !win.closed) {
      win.document.write(html);
      win.document.close();
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (estimatedAudience === 0) { toast.error('Nobody has open findings to notify.'); return; }
    if (!subject.trim() || !body.trim()) { toast.error('Subject and body are required.'); return; }

    // Open window synchronously (user gesture) before any async work.
    const win = openBlankWindow();
    if (win) { fillLoadingWindow(win); handoffWinRef.current = win; }

    setBusy(true);
    try {
      const payload = {
        subject: subject.trim(),
        body: body.trim(),
        cc: [] as string[],
        sources: [] as string[],
        channel,
        deadlineAt: deadlineAt || null,
      };
      const outcome = await broadcastNotification({
        processIdOrCode,
        payload,
        filter: functionId ? { functionId } : {},
      });

      const { success, skipped, failed } = outcome;
      if (skipped > 0 || failed > 0) {
        toast(`Recorded ${success}/${outcome.audience} · skipped ${skipped} · failed ${failed}.`, { icon: '⚠️' });
      } else {
        toast.success(`Broadcast handoff prepared for ${success} manager${success === 1 ? '' : 's'}.`);
      }

      openHandoff(outcome, handoffWinRef.current);
      handoffWinRef.current = null;
      onDone();
      onClose();
    } catch (error) {
      if (handoffWinRef.current && !handoffWinRef.current.closed) {
        handoffWinRef.current.close();
        handoffWinRef.current = null;
      }
      toast.error(error instanceof Error ? error.message : 'Broadcast failed');
    } finally {
      setBusy(false);
    }
  }

  const previewSubject = resolvePreview(subject);
  const previewBody = resolvePreview(body);

  return (
    <Modal
      open={open}
      onClose={() => { if (busy) return; onClose(); }}
      title={
        <span className="flex items-center gap-2">
          <Megaphone size={16} className="text-brand" />
          Broadcast to all managers with open findings
        </span>
      }
      description="One global message sent to every manager with open findings. Outlook opens pre-filled with all recipients — send in one click."
      size="lg"
      dismissOnOverlayClick={!busy}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            leading={<Eye size={14} />}
            onClick={() => setEditMode((v) => !v)}
            disabled={busy}
          >
            {editMode ? 'Preview' : 'Edit message'}
          </Button>
          <Button
            type="submit"
            form="broadcast-form"
            disabled={busy || estimatedAudience === 0}
            leading={<Send size={14} />}
          >
            {busy ? 'Recording…' : `Send to ${estimatedAudience} manager${estimatedAudience === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <form id="broadcast-form" onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-950/40">
          <Megaphone size={16} className="shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <strong>{estimatedAudience}</strong> manager{estimatedAudience === 1 ? '' : 's'} will receive this message
            {estimatedAudience > 1 && channel === 'email' ? ' — all added to a single Outlook email' : ''}
            {estimatedAudience > 1 && channel === 'teams' ? ' — one Teams chat opened per manager' : ''}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="email">Email (Outlook)</option>
              <option value="teams">Teams</option>
            </select>
          </div>
          {functionOptions.length > 0 ? (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Limit to function</label>
              <select
                value={functionId}
                onChange={(e) => setFunctionId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="">All functions</option>
                {functionOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Due date</label>
            <input
              type="date"
              value={deadlineAt}
              onChange={(e) => setDeadlineAt(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
        </div>

        {editMode ? (
          <>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Message body
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                required
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed dark:border-gray-700 dark:bg-gray-900"
              />
              <p className="mt-1 text-[10px] text-gray-500">
                Tokens: {'{{managerName}}'}, {'{{projectCount}}'}, {'{{dueDate}}'} — substituted per-recipient at send time.
              </p>
            </div>
          </>
        ) : (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">
              Message preview (tokens replaced with representative values)
            </div>
            <PreviewPane subject={previewSubject} body={previewBody} deadlineAt={deadlineAt || null} />
          </div>
        )}
      </form>
    </Modal>
  );
}
