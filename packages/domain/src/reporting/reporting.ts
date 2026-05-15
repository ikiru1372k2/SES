import { auditIssueKey } from '../audit/auditEngine';
import type { AuditResult, IssueCorrection } from '../core/types';

const escape = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

export function buildAuditReportHtml(
  processName: string,
  result: AuditResult,
  corrections: Record<string, IssueCorrection> = {},
): string {
  const high = result.issues.filter((issue) => issue.severity === 'High').length;
  const medium = result.issues.filter((issue) => issue.severity === 'Medium').length;
  const low = result.issues.filter((issue) => issue.severity === 'Low').length;
  const correctionRows = result.issues
    .map((issue) => ({ issue, correction: corrections[auditIssueKey(issue)] }))
    .filter((item): item is { issue: typeof item.issue; correction: IssueCorrection } => Boolean(item.correction));
  const recoveredHours = correctionRows.reduce(
    (sum, item) => sum + Math.max(0, item.issue.effort - (item.correction.effort ?? item.issue.effort)),
    0,
  );
  const managerSummary = new Map<string, { count: number; recovered: number }>();
  correctionRows.forEach(({ issue, correction }) => {
    const current = managerSummary.get(issue.projectManager) ?? { count: 0, recovered: 0 };
    managerSummary.set(issue.projectManager, {
      count: current.count + 1,
      recovered: current.recovered + Math.max(0, issue.effort - (correction.effort ?? issue.effort)),
    });
  });
  const correctionSummaryRows = [...managerSummary.entries()]
    .map(([manager, summary]) => `<tr><td>${escape(manager)}</td><td>${summary.count}</td><td>${summary.recovered}</td></tr>`)
    .join('');
  const issueRows = result.issues
    .map((issue) => {
      const correction = corrections[auditIssueKey(issue)];
      return `<tr><td>${escape(issue.displayCode ?? issue.id)}</td><td>${escape(issue.severity)}</td><td>${escape(issue.projectNo)}</td><td>${escape(issue.projectName)}</td><td>${escape(issue.projectManager)}</td><td>${escape(issue.sheetName)}</td><td>${escape(issue.reason ?? issue.notes)}</td><td>${escape(correction?.note ?? '')}</td></tr>`;
    })
    .join('');

  return `<!doctype html><html><head><title>SES Audit Report</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#111827}table{border-collapse:collapse;width:100%;font-size:12px;margin-top:12px}th,td{border:1px solid #d1d5db;padding:8px;text-align:left;vertical-align:top}th{background:#f3f4f6}.metrics{display:flex;gap:12px;margin:20px 0;flex-wrap:wrap}.metric{border:1px solid #d1d5db;padding:12px;min-width:120px}.metric strong{display:block;font-size:24px}h2{margin-top:28px}</style></head><body><h1>${escape(processName)} Audit Report</h1><p>Run at ${escape(new Date(result.runAt).toLocaleString())}</p><div class="metrics"><div class="metric"><strong>${result.scannedRows}</strong>Scanned rows</div><div class="metric"><strong>${result.flaggedRows}</strong>Flagged rows</div><div class="metric"><strong>${high}</strong>High</div><div class="metric"><strong>${medium}</strong>Medium</div><div class="metric"><strong>${low}</strong>Low</div><div class="metric"><strong>${correctionRows.length}</strong>Corrections</div><div class="metric"><strong>${recoveredHours}</strong>Hours recovered</div></div>${correctionSummaryRows ? `<h2>Correction summary</h2><table><thead><tr><th>Manager</th><th>Corrections</th><th>Hours recovered</th></tr></thead><tbody>${correctionSummaryRows}</tbody></table>` : ''}<h2>Flagged projects</h2><table><thead><tr><th>SES Reference</th><th>Severity</th><th>Project No</th><th>Project</th><th>Manager</th><th>Sheet</th><th>Reason</th><th>Correction note</th></tr></thead><tbody>${issueRows}</tbody></table></body></html>`;
}
