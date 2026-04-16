import { Settings, X } from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { createDefaultAuditPolicy, isPolicyChanged, policySummary } from '../../lib/auditPolicy';
import { auditIssueKey, exportIssuesCsv } from '../../lib/auditEngine';
import type { AuditPolicy, AuditProcess, AuditIssue, IssueCategory, IssueComment, WorkbookFile } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { EmptyState } from '../shared/EmptyState';
import { MetricCard } from '../shared/MetricCard';
import { StatusBadge } from '../shared/StatusBadge';

type SortKey = keyof Pick<AuditIssue, 'severity' | 'projectNo' | 'projectName' | 'projectManager' | 'sheetName' | 'projectState' | 'effort' | 'ruleName' | 'reason'>;

const categoryOptions: IssueCategory[] = ['Overplanning', 'Missing Planning', 'Other'];
const issueHeaders: Array<{ key: SortKey; label: string }> = [
  { key: 'severity', label: 'Severity' },
  { key: 'projectNo', label: 'Project No' },
  { key: 'projectName', label: 'Project' },
  { key: 'projectManager', label: 'Manager' },
  { key: 'sheetName', label: 'Sheet' },
  { key: 'projectState', label: 'State' },
  { key: 'effort', label: 'Effort' },
  { key: 'ruleName', label: 'Rule' },
  { key: 'reason', label: 'Reason' },
];

export function AuditResultsTab({ process, file }: { process: AuditProcess; file?: WorkbookFile | undefined }) {
  const result = useAppStore((state) => state.currentAuditResult);
  const runAudit = useAppStore((state) => state.runAudit);
  const addIssueComment = useAppStore((state) => state.addIssueComment);
  const deleteIssueComment = useAppStore((state) => state.deleteIssueComment);
  const [severity, setSeverity] = useState('');
  const [sheet, setSheet] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('severity');
  const [expanded, setExpanded] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const policyChanged = Boolean(result && isPolicyChanged(process.auditPolicy, result.policySnapshot));
  const searchIndex = useMemo(() => {
    return (result?.issues ?? []).map((issue) => ({
      issue,
      blob: [
        issue.severity,
        issue.projectNo,
        issue.projectName,
        issue.projectManager,
        issue.sheetName,
        issue.projectState,
        issue.effort,
        issue.ruleName,
        issue.auditStatus,
        issue.category,
        issue.reason,
        issue.notes,
        issue.recommendedAction,
      ].join(' ').toLowerCase(),
    }));
  }, [result]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return searchIndex
      .filter(({ issue }) => !severity || issue.severity === severity)
      .filter(({ issue }) => !sheet || issue.sheetName === sheet)
      .filter(({ issue }) => !status || issue.auditStatus === status)
      .filter(({ issue }) => !category || issue.category === category)
      .filter(({ blob }) => !query || blob.includes(query))
      .map(({ issue }) => issue)
      .sort((a, b) => String(a[sort] ?? '').localeCompare(String(b[sort] ?? '')));
  }, [searchIndex, severity, sheet, status, category, search, sort]);

  const sheets = result ? [...new Set(result.issues.map((issue) => issue.sheetName))] : [];
  const statuses = result ? [...new Set(result.issues.map((issue) => issue.auditStatus))] : [];
  const hasSelected = Boolean(file?.sheets.some((item) => item.status === 'valid' && item.isSelected));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-gray-950 dark:text-white">Audit Results</h2>
            {policyChanged ? <Badge tone="amber">Policy changed - re-run audit</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-gray-500">{policySummary(result?.policySnapshot ?? process.auditPolicy)}</p>
        </div>
        <button onClick={() => setSettingsOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
          <Settings size={16} />
          QGC Settings
        </button>
      </div>

      {!result ? (
        <EmptyState title="No audit run yet">
          <div className="space-y-1 text-left">
            <div>{file ? 'Done' : '1'} Upload a workbook</div>
            <div>{hasSelected ? 'Done' : '2'} Select sheets in the sidebar</div>
            <div>3 Run audit with the QGC policy</div>
            <div>4 Save a version for traceability</div>
          </div>
          {file ? <button onClick={() => runAudit(process.id, file.id)} disabled={!hasSelected} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Run Audit</button> : null}
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Scanned Rows" value={result.scannedRows} />
            <MetricCard label="Flagged Rows" value={result.flaggedRows} />
            <MetricCard label="Issues" value={result.issues.length} />
            <MetricCard label="Sheets Audited" value={result.sheets.length} />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="font-semibold">Policy used</div>
            <div className="mt-1 text-gray-600 dark:text-gray-300">{policySummary(result.policySnapshot ?? process.auditPolicy)}</div>
            {policyChanged ? <div className="mt-2 text-amber-700 dark:text-amber-300">Settings were changed after this audit. Re-run audit to apply the latest QGC policy.</div> : null}
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700"><tr><th className="p-3">Sheet</th><th>Status</th><th>Rows</th><th>Flagged</th></tr></thead>
              <tbody>
                {file?.sheets.map((item) => {
                  const audited = result.sheets.find((sheetResult) => sheetResult.sheetName === item.name);
                  return <tr key={item.name} className="border-t border-gray-100 dark:border-gray-700"><td className="p-3">{item.name}</td><td><StatusBadge value={item.status === 'valid' ? 'Valid' : item.status === 'duplicate' ? 'Duplicate' : 'Invalid'} /></td><td>{item.rowCount}</td><td>{audited?.flaggedCount ?? '-'}</td></tr>;
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <select value={sheet} onChange={(event) => setSheet(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"><option value="">Sheet</option>{sheets.map((item) => <option key={item}>{item}</option>)}</select>
            <select value={severity} onChange={(event) => setSeverity(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"><option value="">Severity</option><option>High</option><option>Medium</option><option>Low</option></select>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"><option value="">All categories</option>{categoryOptions.map((item) => <option key={item}>{item}</option>)}</select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"><option value="">Rule status</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search..." className="min-w-52 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
            <button onClick={() => exportIssuesCsv('audit-issues.csv', filtered)} className="ml-auto rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700">Export CSV</button>
          </div>

          <div className="overflow-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>{issueHeaders.map(({ key, label }) => <th key={key} onClick={() => setSort(key)} className="cursor-pointer whitespace-nowrap p-3 font-semibold">{label}</th>)}</tr>
              </thead>
              <tbody>
                {filtered.map((issue) => (
                  <>
                    <tr key={issue.id} onClick={() => setExpanded(expanded === issue.id ? '' : issue.id)} className="cursor-pointer border-t border-gray-100 align-top hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700">
                      <td className="p-3"><Badge tone={issue.severity === 'High' ? 'red' : issue.severity === 'Medium' ? 'amber' : 'blue'}>{issue.severity}</Badge></td>
                      <td className="p-3">{issue.projectNo}</td>
                      <td className="p-3">{issue.projectName}</td>
                      <td className="p-3">{issue.projectManager}</td>
                      <td className="p-3">{issue.sheetName}</td>
                      <td className="p-3">{issue.projectState}</td>
                      <td className="p-3">{issue.effort}</td>
                      <td className="p-3">{issue.ruleName ?? issue.auditStatus}</td>
                      <td className="max-w-md p-3">{issue.reason ?? issue.notes}</td>
                    </tr>
                    {expanded === issue.id ? (
                      <tr className="border-t border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                        <td colSpan={9} className="p-4">
                          <div className="grid gap-3 text-sm md:grid-cols-4">
                            <Detail label="Why flagged?" value={issue.reason ?? issue.notes} />
                            <Detail label="Category" value={issue.category ?? 'Audit rule'} />
                            <Detail label="Threshold" value={issue.thresholdLabel ?? '-'} />
                            <Detail label="Recommended action" value={issue.recommendedAction ?? 'Review this project with the owner.'} />
                          </div>
                          <IssueComments
                            comments={process.comments?.[auditIssueKey(issue)] ?? []}
                            onAdd={(body) => addIssueComment(process.id, auditIssueKey(issue), body)}
                            onDelete={(commentId) => deleteIssueComment(process.id, auditIssueKey(issue), commentId)}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </>
                ))}
              </tbody>
            </table>
            {!filtered.length ? <div className="p-5 text-sm text-gray-500">No issues match your filters.</div> : null}
          </div>
        </>
      )}

      {settingsOpen ? <QgcSettingsDrawer process={process} onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

function IssueComments({ comments, onAdd, onDelete }: { comments: IssueComment[]; onAdd: (body: string) => void; onDelete: (commentId: string) => void }) {
  const [body, setBody] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    onAdd(body);
    setBody('');
  }

  return (
    <section className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">Audit trail</h4>
        <span className="text-xs text-gray-500">{comments.length} comment{comments.length === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-3 space-y-2">
        {comments.map((comment) => (
          <div key={comment.id} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-gray-500">{comment.author} - {new Date(comment.createdAt).toLocaleString()}</div>
                <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">{comment.body}</p>
              </div>
              <button type="button" onClick={() => onDelete(comment.id)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>
            </div>
          </div>
        ))}
        {!comments.length ? <div className="text-sm text-gray-500">No notes yet. Capture PM feedback, approval context, or follow-up details here.</div> : null}
      </div>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add audit note..." className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" />
        <Button type="submit" size="sm" disabled={!body.trim()}>Add note</Button>
      </form>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

function QgcSettingsDrawer({ process, onClose }: { process: AuditProcess; onClose: () => void }) {
  const updateAuditPolicy = useAppStore((state) => state.updateAuditPolicy);
  const resetAuditPolicy = useAppStore((state) => state.resetAuditPolicy);
  const [draft, setDraft] = useState<AuditPolicy>(process.auditPolicy);

  function setNumber(key: keyof AuditPolicy, value: string) {
    setDraft((state) => ({ ...state, [key]: Number(value) || 0 }));
  }

  function setFlag(key: keyof AuditPolicy, value: boolean) {
    setDraft((state) => ({ ...state, [key]: value }));
  }

  function save(event: FormEvent) {
    event.preventDefault();
    updateAuditPolicy(process.id, { ...draft, mediumEffortMin: 0, mediumEffortMax: 0, lowEffortEnabled: false });
    toast.success('Settings saved. Re-run audit to apply.');
    onClose();
  }

  function reset() {
    setDraft(createDefaultAuditPolicy());
    resetAuditPolicy(process.id);
    toast.success('QGC settings reset. Re-run audit to apply.');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <form onSubmit={save} className="h-full w-full max-w-md overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">QGC Settings</h3>
            <p className="mt-1 text-sm text-gray-500">Configure thresholds for this process. Re-run audit after saving.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={18} /></button>
        </div>

        <SettingsSection title="Overplanning">
          <NumberField label="Overplanned when effort is greater than" value={draft.highEffortThreshold} suffix="hours" onChange={(value) => setNumber('highEffortThreshold', value)} />
        </SettingsSection>

        <SettingsSection title="Missing Planning">
          <Toggle label="Flag missing effort" checked={draft.missingEffortEnabled} onChange={(checked) => setFlag('missingEffortEnabled', checked)} />
          <Toggle label="Flag zero effort" checked={draft.zeroEffortEnabled} onChange={(checked) => setFlag('zeroEffortEnabled', checked)} />
        </SettingsSection>

        <details className="mt-5 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
          <summary className="cursor-pointer font-semibold">Advanced rules</summary>
          <div className="mt-3 space-y-3">
            <Toggle label="Flag missing manager" checked={draft.missingManagerEnabled} onChange={(checked) => setFlag('missingManagerEnabled', checked)} />
            <Toggle label="Flag In Planning with effort" checked={draft.inPlanningEffortEnabled} onChange={(checked) => setFlag('inPlanningEffortEnabled', checked)} />
            <Toggle label="Flag On Hold with effort" checked={draft.onHoldEffortEnabled} onChange={(checked) => setFlag('onHoldEffortEnabled', checked)} />
            <NumberField label="Flag On Hold when effort is greater than" value={draft.onHoldEffortThreshold} suffix="hours" onChange={(value) => setNumber('onHoldEffortThreshold', value)} />
          </div>
        </details>

        <div className="sticky bottom-0 mt-6 flex gap-2 border-t border-gray-200 bg-white pt-4 dark:border-gray-700 dark:bg-gray-900">
          <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">Save Settings</button>
          <button type="button" onClick={reset} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Reset Defaults</button>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <h4 className="font-semibold">{title}</h4>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function NumberField({ label, value, suffix, onChange }: { label: string; value: number; suffix?: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input type="number" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
        {suffix ? <span className="text-xs text-gray-500">{suffix}</span> : null}
      </div>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /> {label}</label>;
}
