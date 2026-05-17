import type { AuditIssue, AuditVersion, ChangedIssue, ComparisonResult, IssueDiffMap } from '@ses/domain';

export type DiffViewState = 'new' | 'fixed' | 'changed' | 'same';

export type AlignedCompareRow = {
  key: string;
  code: string;
  state: DiffViewState;
  left: string | null;
  right: string | null;
  openIssue: AuditIssue;
};

export function issueRowKey(issue: AuditIssue): string {
  return issue.issueKey ?? `${issue.projectNo}::${issue.sheetName}::${issue.auditStatus ?? ''}`;
}

export function displayIssueCode(issue: AuditIssue): string {
  const key = issue.issueKey?.trim();
  if (key && key.length <= 16) return key;
  return issue.projectNo || key?.slice(0, 12) || '—';
}

export function formatIssueLine(issue: AuditIssue, suffix?: string): string {
  const core =
    issue.reason?.trim() ||
    issue.recommendedAction?.trim() ||
    issue.projectName?.trim() ||
    'Finding';
  const manager = issue.projectManager?.trim();
  const parts = [core];
  if (manager) parts.push(manager);
  if (suffix) parts.push(suffix);
  return parts.join(' · ');
}

function summarizeDiffs(diffs: IssueDiffMap): string | undefined {
  const count = Object.keys(diffs).length;
  if (count === 0) return undefined;
  if (count === 1) return '1 field changed';
  return `${count} fields changed`;
}

export function buildAlignedCompareRows(
  comparison: ComparisonResult,
  fromVersion: AuditVersion,
): AlignedCompareRow[] {
  const fromMap = new Map(fromVersion.result.issues.map((issue) => [issueRowKey(issue), issue]));
  const rows: AlignedCompareRow[] = [];

  for (const issue of comparison.resolvedIssues) {
    rows.push({
      key: issueRowKey(issue),
      code: displayIssueCode(issue),
      state: 'fixed',
      left: formatIssueLine(issue),
      right: null,
      openIssue: issue,
    });
  }

  for (const issue of comparison.newIssues) {
    rows.push({
      key: issueRowKey(issue),
      code: displayIssueCode(issue),
      state: 'new',
      left: null,
      right: formatIssueLine(issue),
      openIssue: issue,
    });
  }

  for (const issue of comparison.changedIssues) {
    const key = issueRowKey(issue);
    const prev = fromMap.get(key);
    rows.push({
      key,
      code: displayIssueCode(issue),
      state: 'changed',
      left: prev ? formatIssueLine(prev) : formatIssueLine(issue),
      right: formatIssueLine(issue, summarizeDiffs(issue.diffs)),
      openIssue: issue,
    });
  }

  for (const issue of comparison.unchangedIssues) {
    const line = formatIssueLine(issue);
    rows.push({
      key: issueRowKey(issue),
      code: displayIssueCode(issue),
      state: 'same',
      left: line,
      right: line,
      openIssue: issue,
    });
  }

  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

export function formatVersionPickerLabel(version: AuditVersion, isHead: boolean): string {
  const date = new Date(version.createdAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
  return `${version.versionName} · ${date}${isHead ? ' (head)' : ''}`;
}

export function formatVersionPanelMeta(version: AuditVersion | undefined): string {
  if (!version) return '';
  const date = new Date(version.createdAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
  const count = version.result.issues.length;
  const note = version.notes?.trim();
  const by = note ? ` by ${note}` : '';
  return `${count} finding${count === 1 ? '' : 's'} · saved ${date}${by}`;
}

export function isChangedIssue(issue: AuditIssue): issue is ChangedIssue {
  return 'diffs' in issue && Boolean((issue as ChangedIssue).diffs);
}
