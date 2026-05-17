// Client-side CSV export for the Analytics chart panel. No backend call —
// every ChartSpec already carries its `data` array in the browser. Used
// only by the analytics PinnedWorkbench (per-chart + export-all).
import type { ChartSpec } from '@ses/domain';

type Row = Record<string, unknown>;

const csvEscape = (cell: unknown) => `"${String(cell ?? '').replaceAll('"', '""')}"`;

function rowsToCsv(columns: string[], rows: Row[]): string {
  const lines = [columns, ...rows.map((r) => columns.map((c) => r[c]))];
  return lines.map((line) => line.map(csvEscape).join(',')).join('\n');
}

/**
 * Normalise any chart spec to (columns, rows). Returns null for shapes
 * with no tabular data to export (e.g. a single KPI value).
 */
function specToTable(spec: ChartSpec): { columns: string[]; rows: Row[] } | null {
  switch (spec.type) {
    case 'bar':
    case 'line':
    case 'area': {
      const ys = Array.isArray(spec.y) ? spec.y : [spec.y];
      return { columns: [spec.x, ...ys], rows: spec.data as Row[] };
    }
    case 'pie':
      return { columns: [spec.name, spec.value], rows: spec.data as Row[] };
    case 'scatter': {
      const cols = [spec.x, spec.y, ...(spec.size ? [spec.size] : [])];
      return { columns: cols, rows: spec.data as Row[] };
    }
    case 'heatmap':
      return { columns: [spec.x, spec.y, spec.value], rows: spec.data as Row[] };
    case 'table':
      return { columns: spec.columns, rows: spec.rows as Row[] };
    case 'kpi':
      return { columns: ['label', 'value'], rows: [{ label: spec.label, value: spec.value }] };
    default:
      return null;
  }
}

export function chartSpecToCsv(spec: ChartSpec): string | null {
  const t = specToTable(spec);
  if (!t || t.rows.length === 0) return null;
  return rowsToCsv(t.columns, t.rows);
}

function safeName(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'chart';
}

function triggerDownload(content: string, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Export one chart's data as a .csv (no-op + false if nothing to export). */
export function exportChartCsv(title: string, spec: ChartSpec): boolean {
  const csv = chartSpecToCsv(spec);
  if (csv === null) return false;
  const date = new Date().toISOString().slice(0, 10);
  triggerDownload(csv, `${safeName(title)}_${date}.csv`, 'text/csv;charset=utf-8');
  return true;
}

/**
 * Export all charts into one CSV file, each preceded by a `## <title>`
 * banner and separated by a blank line. Skips charts with no data.
 */
export function exportAllChartsCsv(
  charts: Array<{ title: string; spec: ChartSpec }>,
  fileBase = 'analytics-charts',
): boolean {
  const blocks: string[] = [];
  for (const c of charts) {
    const csv = chartSpecToCsv(c.spec);
    if (csv === null) continue;
    blocks.push(`## ${c.title}\n${csv}`);
  }
  if (blocks.length === 0) return false;
  const date = new Date().toISOString().slice(0, 10);
  triggerDownload(blocks.join('\n\n'), `${safeName(fileBase)}_${date}.csv`, 'text/csv;charset=utf-8');
  return true;
}
