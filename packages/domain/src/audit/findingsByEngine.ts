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

/** Per-engine context for the email builder so each finding can explain itself. */
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
  /** Joined month labels (e.g. "Mar-2026, Apr-2026"). */
  affectedMonths: string | null;
  zeroMonthCount: number | null;
  /** The missing field's human label (e.g. "Project Industry"). */
  missingFieldLabel: string | null;
  /** Auditor-supplied URL for the project (e.g. BCS deep link). */
  projectLink: string | null;
}

/** Label used for the bucket holding findings that carry no project identifier. */
export const UNASSIGNED_PROJECT_LABEL = 'Unassigned';

type ProjectGroup = {
  /** Stable grouping key — the project identifier the app already uses (projectNo). */
  projectKey: string;
  /** Human-facing section title, e.g. "P1 — Acme Migration". */
  projectTitle: string;
  /** True when the finding carries no project identifier (sorted last). */
  isUnassigned: boolean;
  /** All findings for this project, in first-seen order. */
  rows: EngineFindingLine[];
};

function projectIdentity(line: EngineFindingLine): { key: string; title: string; isUnassigned: boolean } {
  const no = (line.projectNo ?? '').trim();
  const name = (line.projectName ?? '').trim();
  if (!no && !name) {
    return { key: ' unassigned', title: UNASSIGNED_PROJECT_LABEL, isUnassigned: true };
  }
  // projectNo is the identity the rest of the app keys on (e.g. projectLinks map);
  // fall back to the name only when the number is absent.
  return { key: no || name, title: [no, name].filter(Boolean).join(' — '), isUnassigned: false };
}

/**
 * Groups findings by unique project. Projects are ordered A–Z by title, with the
 * "Unassigned" bucket always last. Findings keep first-seen order within a project.
 */
function groupByProject(lines: EngineFindingLine[]): ProjectGroup[] {
  const byProject = new Map<string, ProjectGroup>();
  for (const line of lines) {
    const { key, title, isUnassigned } = projectIdentity(line);
    let project = byProject.get(key);
    if (!project) {
      project = { projectKey: key, projectTitle: title, isUnassigned, rows: [] };
      byProject.set(key, project);
    }
    project.rows.push(line);
  }
  return [...byProject.values()].sort((a, b) => {
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
    return a.projectTitle.localeCompare(b.projectTitle, undefined, { sensitivity: 'base', numeric: true });
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dash(value: string | null | undefined): string {
  const trimmed = (value ?? '').toString().trim();
  return trimmed.length === 0 ? '—' : trimmed;
}

function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(1, max - 1)).trimEnd() + '…';
}

/**
 * A short, plain-language label for what is wrong — deliberately free of any
 * internal engine/check naming so the recipient just sees the issue.
 */
function findingIssueLabel(line: EngineFindingLine): string {
  const d = line.detail;
  const label =
    (d?.missingFieldLabel?.trim() || '') ||
    (d?.ruleName?.trim() || '') ||
    (line.ruleName?.trim() || '') ||
    (d?.reason?.trim() || '') ||
    (line.notes?.trim() || '');
  return clamp(label || 'Finding', 80);
}

/** Supporting context for a finding (no engine wording), joined into one cell. */
function findingDetailText(line: EngineFindingLine): string {
  const d = line.detail;
  const issueLabel = d?.missingFieldLabel?.trim() || d?.ruleName?.trim() || line.ruleName?.trim() || '';
  const parts: string[] = [];
  const reason = (d?.reason ?? line.notes ?? '').trim();
  if (reason && reason !== issueLabel) parts.push(reason);
  if (d?.affectedMonths?.trim()) parts.push(`Affected month(s): ${d.affectedMonths.trim()}`);
  if (d?.thresholdLabel?.trim()) parts.push(`Threshold: ${d.thresholdLabel.trim()}`);
  else if (d?.effort != null && Number.isFinite(d.effort)) parts.push(`Value: ${d.effort}`);
  if (d?.projectState?.trim()) parts.push(`State: ${d.projectState.trim()}`);
  if (d?.zeroMonthCount != null) parts.push(`Months at zero: ${d.zeroMonthCount}`);
  return parts.join(' · ');
}

type Column = {
  header: string;
  /** CSS percentage width for the HTML renderer. */
  width: string;
  /** Marks the column as a hyperlink in the HTML renderer. */
  isLink?: boolean;
  read: (row: EngineFindingLine) => string;
};

/**
 * A single, engine-agnostic column set used for every project. The recipient
 * sees the issue and its context without any reference to which check produced it.
 */
function genericColumns(hasProjectLink: boolean): Column[] {
  const linkCol: Column[] = hasProjectLink
    ? [{ header: 'Link', width: '16%', isLink: true, read: (r) => r.detail?.projectLink?.trim() || '' }]
    : [];
  return [
    { header: '#', width: '5%', read: () => '' },
    { header: 'Issue', width: hasProjectLink ? '28%' : '32%', read: (r) => findingIssueLabel(r) },
    { header: 'Details', width: hasProjectLink ? '37%' : '45%', read: (r) => clamp(dash(findingDetailText(r)), 160) },
    { header: 'Severity', width: hasProjectLink ? '14%' : '18%', read: (r) => dash(r.detail?.severity ?? r.severity) },
    ...linkCol,
  ];
}

export function buildFindingsByEngineMarkdown(lines: EngineFindingLine[]): string {
  if (!lines.length) return '_No open findings._';
  const parts: string[] = [];
  for (const project of groupByProject(lines)) {
    parts.push(`### ${project.projectTitle} (${project.rows.length} finding${project.rows.length === 1 ? '' : 's'})`);
    for (const r of project.rows) {
      const details = findingDetailText(r);
      parts.push(
        `- **${findingIssueLabel(r)}** (${dash(r.detail?.severity ?? r.severity)})${details ? ` — ${details}` : ''}`,
      );
    }
    parts.push('');
  }
  return parts.join('\n').trim();
}

const HTML_TABLE_STYLE =
  'border-collapse:collapse;width:100%;font-family:Arial,Helvetica,sans-serif;border:1.5px solid #334155;table-layout:fixed;';
const HTML_HEAD_STYLE =
  'border:1px solid #334155;padding:8px 10px;font-size:12px;font-weight:700;background:#1e293b;color:#ffffff;text-align:left;letter-spacing:0.02em;';
const HTML_CELL_STYLE =
  'border:1px solid #cbd5e1;padding:8px 10px;font-size:13px;color:#0f172a;vertical-align:top;word-wrap:break-word;overflow-wrap:break-word;';
const HTML_CELL_STYLE_ALT = HTML_CELL_STYLE + 'background:#f8fafc;';
const HTML_PROJECT_HEADER_STYLE =
  'font-size:16px;font-weight:700;color:#0f172a;margin:0 0 12px 0;padding:0 0 6px 0;border-bottom:2px solid #334155;';

/** Renders one project's findings as a styled HTML table. */
function renderProjectHtmlBlock(project: ProjectGroup): string {
  const hasProjectLink = project.rows.some((r) => Boolean(r.detail?.projectLink?.trim()));
  const columns = genericColumns(hasProjectLink);
  const colgroup =
    `<colgroup>` + columns.map((c) => `<col style="width:${c.width};">`).join('') + `</colgroup>`;
  const headerCells = columns
    .map((c) => `<th style="${HTML_HEAD_STYLE}">${escapeHtml(c.header)}</th>`)
    .join('');
  const bodyRows = project.rows
    .map((r, idx) => {
      const cellStyle = idx % 2 === 0 ? HTML_CELL_STYLE : HTML_CELL_STYLE_ALT;
      const cells = columns
        .map((c, cIdx) => {
          if (cIdx === 0) return `<td style="${cellStyle}">${idx + 1}</td>`;
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
  return (
    `<div style="margin:0 0 26px 0;">` +
    `<div style="${HTML_PROJECT_HEADER_STYLE}">` +
    `${escapeHtml(project.projectTitle)} ` +
    `<span style="color:#64748b;font-weight:400;font-size:13px;">(${project.rows.length} finding${project.rows.length === 1 ? '' : 's'})</span>` +
    `</div>` +
    `<table cellpadding="0" cellspacing="0" border="1" style="${HTML_TABLE_STYLE}">` +
    colgroup +
    `<thead><tr>${headerCells}</tr></thead>` +
    `<tbody>${bodyRows}</tbody>` +
    `</table></div>`
  );
}

/** Renders findings as styled HTML, grouped by project. Inline styles (no <style> block) so Outlook/Gmail/Teams render correctly. */
export function buildFindingsByEngineHtmlTable(lines: EngineFindingLine[]): string {
  if (!lines.length) {
    return '<p style="margin:0;color:#475569;font-style:italic;">No open findings.</p>';
  }
  return groupByProject(lines).map(renderProjectHtmlBlock).join('');
}

/** Renders one project's findings as a fixed-width text table block. */
function renderProjectTextBlock(project: ProjectGroup): string[] {
  const hasProjectLink = project.rows.some((r) => Boolean(r.detail?.projectLink?.trim()));
  const columns = genericColumns(hasProjectLink);
  const blocks: string[] = [];
  blocks.push(`=== ${project.projectTitle} (${project.rows.length} finding${project.rows.length === 1 ? '' : 's'}) ===`);
  const renderedRows = project.rows.map((row, idx) =>
    columns.map((column, columnIndex) => (columnIndex === 0 ? String(idx + 1) : column.read(row))),
  );
  const widths = columns.map((column, index) =>
    Math.min(
      Math.max(column.header.length, ...renderedRows.map((row) => row[index]?.length ?? 0)),
      index === 0 ? 3 : 44,
    ),
  );
  const renderRow = (values: string[]) =>
    values.map((value, index) => clamp(value || '—', widths[index]!).padEnd(widths[index]!)).join('  ');
  blocks.push(renderRow(columns.map((c) => c.header)));
  blocks.push(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of renderedRows) blocks.push(renderRow(row));
  blocks.push('');
  return blocks;
}

export function buildFindingsByEngineTextTable(lines: EngineFindingLine[]): string {
  if (!lines.length) return 'No open findings.';
  const blocks: string[] = [];
  for (const project of groupByProject(lines)) blocks.push(...renderProjectTextBlock(project));
  return blocks.join('\n').trim();
}
