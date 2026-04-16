import type { AuditProcess, AuditResult } from './types';
import { auditIssueKey } from './auditEngine';

const escape = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function openAuditReport(process: AuditProcess, result: AuditResult): void {
  const high = result.issues.filter((issue) => issue.severity === 'High').length;
  const medium = result.issues.filter((issue) => issue.severity === 'Medium').length;
  const low = result.issues.filter((issue) => issue.severity === 'Low').length;
  const rows = result.issues
    .map((issue) => {
      const correction = process.corrections?.[auditIssueKey(issue)];
      return `<tr><td>${escape(issue.severity)}</td><td>${escape(issue.projectNo)}</td><td>${escape(issue.projectName)}</td><td>${escape(issue.projectManager)}</td><td>${escape(issue.sheetName)}</td><td>${escape(issue.reason ?? issue.notes)}</td><td>${escape(correction?.note ?? '')}</td></tr>`;
    })
    .join('');
  const html = `<!doctype html><html><head><title>SES Audit Report</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#111827}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #d1d5db;padding:8px;text-align:left;vertical-align:top}th{background:#f3f4f6}.metrics{display:flex;gap:12px;margin:20px 0}.metric{border:1px solid #d1d5db;padding:12px;min-width:120px}.metric strong{display:block;font-size:24px}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Save as PDF</button><h1>${escape(process.name)} Audit Report</h1><p>Run at ${escape(new Date(result.runAt).toLocaleString())}</p><div class="metrics"><div class="metric"><strong>${result.scannedRows}</strong>Scanned rows</div><div class="metric"><strong>${result.flaggedRows}</strong>Flagged rows</div><div class="metric"><strong>${high}</strong>High</div><div class="metric"><strong>${medium}</strong>Medium</div><div class="metric"><strong>${low}</strong>Low</div></div><table><thead><tr><th>Severity</th><th>Project No</th><th>Project</th><th>Manager</th><th>Sheet</th><th>Reason</th><th>Correction note</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  const report = window.open('', '_blank', 'noopener,noreferrer');
  if (!report) return;
  report.document.write(html);
  report.document.close();
}
