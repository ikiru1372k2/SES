export type EngineFindingLine = {
  engineKey: string;
  engineLabel: string;
  projectNo: string;
  projectName: string;
  severity: string;
  ruleName: string;
  notes: string;
};

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
