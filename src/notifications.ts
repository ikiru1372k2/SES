import type { AuditSummary, AuditedRow, NotificationDraft } from "./types.js";
import { escapeHtml } from "./utils.js";

function buildHtml(recipient: string, rows: AuditedRow[], summary: AuditSummary): string {
  const tableRows = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.projectNo)}</td>
          <td>${escapeHtml(row.project)}</td>
          <td>${escapeHtml(row.projectState)}</td>
          <td>${row.effortHours ?? "N/A"}</td>
          <td>${escapeHtml(row.auditStatus)}</td>
          <td>${escapeHtml(row.auditNotes)}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Audit Preview - ${escapeHtml(recipient)}</title>
      <style>
        body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; color: #1f2937; }
        h1 { margin-bottom: 8px; }
        .meta { margin-bottom: 20px; }
        .stats { display: flex; gap: 16px; margin-bottom: 20px; }
        .card { background: #f8fafc; border: 1px solid #dbe2ea; border-radius: 10px; padding: 12px 16px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
        th { background: #eff6ff; }
      </style>
    </head>
    <body>
      <h1>Effort Audit Notification</h1>
      <div class="meta">Prepared for <strong>${escapeHtml(recipient)}</strong></div>
      <div class="stats">
        <div class="card">Flagged Projects: <strong>${rows.length}</strong></div>
        <div class="card">High Issues: <strong>${summary.bySeverity.High}</strong></div>
        <div class="card">Medium Issues: <strong>${summary.bySeverity.Medium}</strong></div>
        <div class="card">Low Issues: <strong>${summary.bySeverity.Low}</strong></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Project No.</th>
            <th>Project</th>
            <th>State</th>
            <th>Effort (H)</th>
            <th>Audit Status</th>
            <th>Audit Notes</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </body>
  </html>`;
}

function buildText(recipient: string, rows: AuditedRow[]): string {
  const lines = rows.map(
    (row) =>
      `- ${row.projectNo} | ${row.project} | ${row.projectState} | Effort: ${row.effortHours ?? "N/A"} | ${row.auditStatus}`,
  );

  return [`Effort audit notification for ${recipient}`, "", ...lines].join("\n");
}

export function buildNotificationDrafts(rows: AuditedRow[], summary: AuditSummary): NotificationDraft[] {
  const grouped = new Map<string, AuditedRow[]>();

  for (const row of rows.filter((item) => item.issues.length > 0 && item.email)) {
    const groupId = `${row.projectManager}||${row.email}`;
    const existing = grouped.get(groupId) ?? [];
    existing.push(row);
    grouped.set(groupId, existing);
  }

  return [...grouped.entries()].map(([groupId, groupedRows]) => {
    const projectManager = groupedRows[0]?.projectManager ?? "Project Manager";
    const [, email] = groupId.split("||");
    return {
      recipientEmail: email,
      projectManager,
      subject: `Effort audit findings for ${projectManager} (${groupedRows.length} flagged project${groupedRows.length === 1 ? "" : "s"})`,
      summary,
      rows: groupedRows.map((row) => ({
        projectNo: row.projectNo,
        project: row.project,
        projectState: row.projectState,
        effortHours: row.effortHours,
        auditStatus: row.auditStatus,
        auditSeverity: row.auditSeverity,
        auditNotes: row.auditNotes,
      })),
      html: buildHtml(projectManager, groupedRows, summary),
      text: buildText(projectManager, groupedRows),
    };
  });
}
