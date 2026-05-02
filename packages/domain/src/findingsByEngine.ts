export type EngineFindingLine = {
  engineKey: string;
  engineLabel: string;
  projectNo: string;
  projectName: string;
  severity: string;
  ruleName: string;
  notes: string;
  /** Optional issue identifier (e.g. tracking issue key). */
  issueKey?: string;
  /** Optional task name from the source row. */
  taskName?: string;
  /** Optional employee/resource name from the source row. */
  employeeName?: string;
  /** Optional country / region label. */
  country?: string;
  /** Engine-specific rich context — see EngineFindingDetail for fields. */
  detail?: EngineFindingDetail;
};

/**
 * Per-engine context stripped from `AuditIssue` rows so the email builder
 * can emit a column set that actually explains the finding. Different
 * engines surface different columns: e.g. master-data needs the missing
 * field name, over-planning wants the offending months and threshold,
 * function-rate / internal-cost-rate want the zero-month count.
 */
export interface EngineFindingDetail {
  ruleCode: string;
  ruleName: string;
  ruleCategory: string;
  severity: string;
  reason: string | null;
  thresholdLabel: string | null;
  recommendedAction: string | null;
  sheetName: string | null;
  projectManager: string | null;
  projectState: string | null;
  effort: number | null;
  /** Joined month labels (e.g. "Mar-2026, Apr-2026") for over-planning / rate engines. */
  affectedMonths: string | null;
  zeroMonthCount: number | null;
  /** Master-data: the missing field's human label (e.g. "Project Industry"). */
  missingFieldLabel: string | null;
  /** Auditor-supplied URL for the project (e.g. BCS deep link). */
  projectLink: string | null;
}

export function buildFindingsByEngineMarkdown(lines: EngineFindingLine[]): string {
  if (!lines.length) return '_No open findings._';
  const byEngine = new Map<string, { label: string; rows: EngineFindingLine[] }>();
  for (const line of lines) {
    const key = line.engineKey;
    if (!byEngine.has(key)) {
      byEngine.set(key, { label: line.engineLabel, rows: [] });
    }
    byEngine.get(key)!.rows.push(line);
  }
  const parts: string[] = [];
  for (const [, { label, rows }] of byEngine) {
    parts.push(`### ${label}`);
    for (const r of rows) {
      const title = [r.projectNo, r.projectName].filter(Boolean).join(' — ') || 'Project';
      parts.push(`- **${title}** (${r.severity}): ${r.ruleName}${r.notes ? ` — ${r.notes}` : ''}`);
    }
    parts.push('');
  }
  return parts.join('\n').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type ColumnSpec<T> = {
  header: string;
  read: (row: T) => string;
};

const HTML_TABLE_STYLE =
  'border-collapse:collapse;width:100%;font-family:Arial,Helvetica,sans-serif;border:1.5px solid #334155;table-layout:fixed;';
const HTML_HEAD_STYLE =
  'border:1px solid #334155;padding:8px 10px;font-size:12px;font-weight:700;background:#1e293b;color:#ffffff;text-align:left;letter-spacing:0.02em;';
const HTML_CELL_STYLE =
  'border:1px solid #cbd5e1;padding:8px 10px;font-size:13px;color:#0f172a;vertical-align:top;word-wrap:break-word;overflow-wrap:break-word;';
const HTML_CELL_STYLE_ALT = HTML_CELL_STYLE + 'background:#f8fafc;';

function dash(value: string | null | undefined): string {
  const trimmed = (value ?? '').toString().trim();
  return trimmed.length === 0 ? '—' : trimmed;
}

function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(1, max - 1)).trimEnd() + '…';
}

/**
 * Engine → column map. Each engine surfaces only the columns that explain
 * its findings; values are clamped so wide free-text fields can't blow up
 * the layout. `width` is a CSS percentage so the HTML grid stays even when
 * the data is uneven. The optional `Project Link` column is appended only
 * when at least one finding in the engine has a link supplied — otherwise
 * the column is dropped so the table doesn't carry empty space.
 */
type EngineColumn = ColumnSpec<EngineFindingLine> & {
  width: string;
  /** Marks the column as a hyperlink in the HTML renderer. */
  isLink?: boolean;
};

const PROJECT_LINK_COLUMN: EngineColumn = {
  header: 'Project Link',
  width: '20%',
  isLink: true,
  read: (r) => r.detail?.projectLink?.trim() || '',
};

function columnsForEngine(engineKey: string, hasProjectLink: boolean): EngineColumn[] {
  const linkCol = hasProjectLink ? [PROJECT_LINK_COLUMN] : [];
  switch (engineKey) {
    case 'master-data':
      return [
        { header: '#', width: '4%', read: () => '' },
        { header: 'Project ID', width: '14%', read: (r) => dash(r.projectNo) },
        { header: 'Project Name', width: hasProjectLink ? '26%' : '34%', read: (r) => clamp(dash(r.projectName), 60) },
        { header: 'Missing Field', width: hasProjectLink ? '24%' : '32%', read: (r) => dash(r.detail?.missingFieldLabel ?? r.detail?.ruleName) },
        { header: 'Severity', width: hasProjectLink ? '12%' : '16%', read: (r) => dash(r.detail?.severity) },
        ...linkCol,
      ];
    case 'over-planning':
      return [
        { header: '#', width: '4%', read: () => '' },
        { header: 'Project ID', width: '14%', read: (r) => dash(r.projectNo) },
        { header: 'Project Name', width: hasProjectLink ? '22%' : '28%', read: (r) => clamp(dash(r.projectName), 60) },
        { header: 'Issue', width: hasProjectLink ? '15%' : '18%', read: (r) => dash(r.detail?.ruleName) },
        { header: 'Affected Month(s)', width: hasProjectLink ? '15%' : '18%', read: (r) => dash(r.detail?.affectedMonths) },
        { header: 'Effort / Threshold', width: hasProjectLink ? '12%' : '14%', read: (r) => dash(r.detail?.thresholdLabel ?? (r.detail?.effort != null ? `${r.detail.effort}` : '')) },
        { header: 'Severity', width: '8%', read: (r) => dash(r.detail?.severity) },
        ...linkCol,
      ];
    case 'missing-plan':
      return [
        { header: '#', width: '4%', read: () => '' },
        { header: 'Project ID', width: '14%', read: (r) => dash(r.projectNo) },
        { header: 'Project Name', width: hasProjectLink ? '24%' : '32%', read: (r) => clamp(dash(r.projectName), 60) },
        { header: 'State', width: hasProjectLink ? '14%' : '18%', read: (r) => dash(r.detail?.projectState) },
        { header: 'Issue', width: hasProjectLink ? '24%' : '32%', read: (r) => dash(r.detail?.ruleName) },
        ...linkCol,
      ];
    case 'function-rate':
      return [
        { header: '#', width: '4%', read: () => '' },
        { header: 'Project ID', width: '12%', read: (r) => dash(r.projectNo) },
        { header: 'Project Name', width: hasProjectLink ? '16%' : '22%', read: (r) => clamp(dash(r.projectName), 60) },
        { header: 'Resource', width: '14%', read: (r) => dash(r.detail?.projectManager) },
        { header: 'Issue', width: hasProjectLink ? '12%' : '13%', read: (r) => dash(r.detail?.ruleName) },
        { header: 'Affected Month(s)', width: hasProjectLink ? '14%' : '17%', read: (r) => dash(r.detail?.affectedMonths) },
        { header: 'Zero Months', width: '11%', read: (r) => dash(r.detail?.zeroMonthCount != null ? String(r.detail.zeroMonthCount) : '') },
        { header: 'Severity', width: hasProjectLink ? '7%' : '10%', read: (r) => dash(r.detail?.severity) },
        ...linkCol,
      ];
    case 'internal-cost-rate':
      return [
        { header: '#', width: '4%', read: () => '' },
        { header: 'Project ID', width: '12%', read: (r) => dash(r.projectNo) },
        { header: 'Project Name', width: hasProjectLink ? '16%' : '22%', read: (r) => clamp(dash(r.projectName), 60) },
        { header: 'Resource', width: '14%', read: (r) => dash(r.detail?.projectManager) },
        { header: 'Issue', width: hasProjectLink ? '12%' : '13%', read: (r) => dash(r.detail?.ruleName) },
        { header: 'Affected Month(s)', width: hasProjectLink ? '14%' : '17%', read: (r) => dash(r.detail?.affectedMonths) },
        { header: 'Zero Months', width: '11%', read: (r) => dash(r.detail?.zeroMonthCount != null ? String(r.detail.zeroMonthCount) : '') },
        { header: 'Severity', width: hasProjectLink ? '7%' : '10%', read: (r) => dash(r.detail?.severity) },
        ...linkCol,
      ];
    case 'opportunities':
      // Opportunity records: surface the columns an account owner needs
      // to fix the row in the source CRM — opportunity ID + name, the
      // category (sales phase / status), the probability number that
      // gates several rules, and the rule violations the engine joined
      // into `reason`. Mirrors the master-data layout: identity columns
      // first, what's wrong second, severity last.
      return [
        { header: '#', width: '4%', read: () => '' },
        { header: 'Opportunity ID', width: '14%', read: (r) => dash(r.projectNo) },
        { header: 'Opportunity', width: hasProjectLink ? '22%' : '28%', read: (r) => clamp(dash(r.projectName), 60) },
        { header: 'Category', width: hasProjectLink ? '12%' : '14%', read: (r) => dash(r.detail?.projectState) },
        {
          header: 'Probability',
          width: '10%',
          read: (r) =>
            r.detail?.effort != null && Number.isFinite(r.detail.effort)
              ? `${r.detail.effort}%`
              : '—',
        },
        {
          header: 'Issue',
          width: hasProjectLink ? '24%' : '32%',
          read: (r) => clamp(dash(r.detail?.reason ?? r.detail?.ruleName), 110),
        },
        { header: 'Severity', width: hasProjectLink ? '8%' : '12%', read: (r) => dash(r.detail?.severity) },
        ...linkCol,
      ];
    default:
      return [
        { header: '#', width: '5%', read: () => '' },
        { header: 'Project ID', width: '15%', read: (r) => dash(r.projectNo) },
        { header: 'Project Name', width: hasProjectLink ? '20%' : '25%', read: (r) => clamp(dash(r.projectName), 60) },
        { header: 'Issue', width: '20%', read: (r) => dash(r.detail?.ruleName ?? r.ruleName) },
        { header: 'Severity', width: '10%', read: (r) => dash(r.detail?.severity ?? r.severity) },
        { header: 'Notes', width: hasProjectLink ? '15%' : '25%', read: (r) => clamp(dash(r.detail?.reason ?? r.notes), 80) },
        ...linkCol,
      ];
  }
}

function shortDescriptionForEngine(engineKey: string): string {
  switch (engineKey) {
    case 'master-data':
      return 'Required master-data fields are missing or contain placeholder values for the projects below. Please update the records so audits can complete.';
    case 'over-planning':
      return 'The following projects show monthly effort above the configured planning threshold. Please review and confirm or correct the planning entries.';
    case 'missing-plan':
      return 'The following projects have no planned effort recorded. Please add a plan or confirm the project should be inactive.';
    case 'function-rate':
      return 'External function rates are missing or recorded as zero for the months shown below. Please update the rate sheet.';
    case 'internal-cost-rate':
      return 'Internal cost rates are missing or recorded as zero for the months shown below. Please confirm or update the cost entries.';
    case 'opportunities':
      return 'The following opportunities have data quality issues that block forecasting and pipeline reporting. Please review the records in the source CRM and correct the flagged fields.';
    default:
      return 'Open findings for the projects listed below need attention.';
  }
}

/**
 * Render the findings as a styled HTML table grouped by engine, with each
 * engine getting the columns that actually explain its findings (set in
 * `columnsForEngine`). Inline styles are deliberately verbose so the
 * markup survives the trip through Outlook / Gmail / Teams web (none of
 * them honour <style> blocks reliably).
 */
export function buildFindingsByEngineHtmlTable(lines: EngineFindingLine[]): string {
  if (!lines.length) {
    return '<p style="margin:0;color:#475569;font-style:italic;">No open findings.</p>';
  }
  const byEngine = new Map<string, { label: string; rows: EngineFindingLine[] }>();
  for (const line of lines) {
    const key = line.engineKey;
    if (!byEngine.has(key)) byEngine.set(key, { label: line.engineLabel, rows: [] });
    byEngine.get(key)!.rows.push(line);
  }

  const blocks: string[] = [];
  for (const [engineKey, { label, rows }] of byEngine) {
    const hasProjectLink = rows.some((r) => Boolean(r.detail?.projectLink?.trim()));
    const columns = columnsForEngine(engineKey, hasProjectLink);
    const description = shortDescriptionForEngine(engineKey);
    const colgroup =
      `<colgroup>` +
      columns.map((c) => `<col style="width:${c.width};">`).join('') +
      `</colgroup>`;
    const headerCells = columns
      .map((c) => `<th style="${HTML_HEAD_STYLE}">${escapeHtml(c.header)}</th>`)
      .join('');
    const bodyRows = rows
      .map((r, idx) => {
        const cellStyle = idx % 2 === 0 ? HTML_CELL_STYLE : HTML_CELL_STYLE_ALT;
        const cells = columns
          .map((c, cIdx) => {
            if (cIdx === 0) {
              return `<td style="${cellStyle}">${idx + 1}</td>`;
            }
            const value = c.read(r);
            if (c.isLink) {
              const url = value.trim();
              if (!url) return `<td style="${cellStyle}">—</td>`;
              const safeUrl = escapeHtml(url);
              return (
                `<td style="${cellStyle}">` +
                `<a href="${safeUrl}" style="color:#1d4ed8;text-decoration:underline;word-break:break-all;" target="_blank" rel="noopener noreferrer">Open project</a>` +
                `</td>`
              );
            }
            return `<td style="${cellStyle}">${escapeHtml(value)}</td>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
    blocks.push(
      `<div style="margin:0 0 22px 0;">` +
        `<div style="font-size:14px;font-weight:700;color:#0f172a;margin:0 0 4px 0;">` +
        `${escapeHtml(label)} <span style="color:#64748b;font-weight:400;">(${rows.length} finding${rows.length === 1 ? '' : 's'})</span>` +
        `</div>` +
        `<div style="font-size:12px;color:#475569;margin:0 0 10px 0;line-height:1.45;">${escapeHtml(description)}</div>` +
        `<table cellpadding="0" cellspacing="0" border="1" style="${HTML_TABLE_STYLE}">` +
        colgroup +
        `<thead><tr>${headerCells}</tr></thead>` +
        `<tbody>${bodyRows}</tbody>` +
        `</table></div>`,
    );
  }
  return blocks.join('');
}

export function buildFindingsByEngineTextTable(lines: EngineFindingLine[]): string {
  if (!lines.length) return 'No open findings.';
  const byEngine = new Map<string, { label: string; rows: EngineFindingLine[] }>();
  for (const line of lines) {
    const key = line.engineKey;
    if (!byEngine.has(key)) byEngine.set(key, { label: line.engineLabel, rows: [] });
    byEngine.get(key)!.rows.push(line);
  }
  const blocks: string[] = [];
  for (const [engineKey, { label, rows }] of byEngine) {
    const hasProjectLink = rows.some((r) => Boolean(r.detail?.projectLink?.trim()));
    const columns = columnsForEngine(engineKey, hasProjectLink);
    blocks.push(`${label} (${rows.length} finding${rows.length === 1 ? '' : 's'})`);
    blocks.push(shortDescriptionForEngine(engineKey));
    const renderedRows = rows.map((row, idx) =>
      columns.map((column, columnIndex) => (columnIndex === 0 ? String(idx + 1) : column.read(row))),
    );
    const widths = columns.map((column, index) =>
      Math.min(
        Math.max(
          column.header.length,
          ...renderedRows.map((row) => row[index]?.length ?? 0),
        ),
        index === 0 ? 3 : 36,
      ),
    );
    const renderRow = (values: string[]) =>
      values
        .map((value, index) => clamp(value || '—', widths[index]!).padEnd(widths[index]!))
        .join('  ');
    blocks.push(renderRow(columns.map((c) => c.header)));
    blocks.push(widths.map((width) => '-'.repeat(width)).join('  '));
    for (const row of renderedRows) {
      blocks.push(renderRow(row));
    }
    blocks.push('');
  }
  return blocks.join('\n').trim();
}
