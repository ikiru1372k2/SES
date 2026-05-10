/**
 * ChartSpec — what the analytics agent emits and what ChartRenderer
 * consumes. Discriminated union by `type`. Every spec carries a
 * `source` block so auditors can trace any chart back to the SQL
 * that produced it.
 */

export type ChartType =
  | 'kpi'
  | 'bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'scatter'
  | 'heatmap'
  | 'table';

export type Row = Record<string, unknown>;

export interface ChartFormat {
  value?: 'number' | 'currency' | 'percent' | 'date';
  locale?: string;
  currency?: string;
}

export interface ChartSource {
  /** SQL exposed via the "Show SQL" toggle in the chart card. */
  sql?: string;
  executed_at: string;
  row_count: number;
  /** Used for cache + audit; matches ai_chat_audit.version_ref or a hash. */
  dataset_version: string;
}

export interface ChartDrilldown {
  /** Template with {x}, {y}, {series}, {datum} placeholders. */
  questionTemplate: string;
  bindings: Record<string, 'x' | 'y' | 'series' | 'datum'>;
}

export interface ChartCommon {
  theme?: 'light' | 'dark' | 'auto';
  format?: ChartFormat;
  source: ChartSource;
  drilldown?: ChartDrilldown;
  /** Pre-computed shape-compatible alternatives for the ChartPicker. */
  alternative_specs?: ChartSpec[];
}

export interface KpiSpec extends ChartCommon {
  type: 'kpi';
  label: string;
  value: number | string;
  delta?: number;
}

export interface XYSpec extends ChartCommon {
  type: 'bar' | 'line' | 'area';
  data: Row[];
  x: string;
  y: string | string[];
  stacked?: boolean;
}

export interface PieSpec extends ChartCommon {
  type: 'pie';
  data: Row[];
  name: string;
  value: string;
}

export interface ScatterSpec extends ChartCommon {
  type: 'scatter';
  data: Row[];
  x: string;
  y: string;
  size?: string;
}

export interface HeatmapSpec extends ChartCommon {
  type: 'heatmap';
  data: Row[];
  x: string;
  y: string;
  value: string;
}

export interface TableSpec extends ChartCommon {
  type: 'table';
  columns: string[];
  rows: Row[];
}

export type ChartSpec =
  | KpiSpec
  | XYSpec
  | PieSpec
  | ScatterSpec
  | HeatmapSpec
  | TableSpec;

const ALL_TYPES: ChartType[] = ['kpi', 'bar', 'line', 'area', 'pie', 'scatter', 'heatmap', 'table'];

/** Lightweight runtime validator (no zod dep). Throws on invalid shapes. */
export function validateChartSpec(spec: unknown): ChartSpec {
  if (!spec || typeof spec !== 'object') throw new Error('chart_spec must be an object');
  const s = spec as Record<string, unknown>;
  const t = s.type as ChartType;
  if (!ALL_TYPES.includes(t)) throw new Error(`chart_spec.type must be one of ${ALL_TYPES.join(', ')}`);
  if (!s.source || typeof s.source !== 'object') throw new Error('chart_spec.source is required');
  const src = s.source as Record<string, unknown>;
  if (typeof src.executed_at !== 'string' || typeof src.dataset_version !== 'string')
    throw new Error('chart_spec.source.{executed_at,dataset_version} required');

  switch (t) {
    case 'kpi':
      if (!('label' in s) || !('value' in s)) throw new Error('kpi requires label + value');
      break;
    case 'bar':
    case 'line':
    case 'area':
      if (!Array.isArray(s.data) || typeof s.x !== 'string' || (typeof s.y !== 'string' && !Array.isArray(s.y)))
        throw new Error(`${t} requires data + x + y`);
      break;
    case 'pie':
      if (!Array.isArray(s.data) || typeof s.name !== 'string' || typeof s.value !== 'string')
        throw new Error('pie requires data + name + value');
      break;
    case 'scatter':
      if (!Array.isArray(s.data) || typeof s.x !== 'string' || typeof s.y !== 'string')
        throw new Error('scatter requires data + x + y');
      break;
    case 'heatmap':
      if (!Array.isArray(s.data) || typeof s.x !== 'string' || typeof s.y !== 'string' || typeof s.value !== 'string')
        throw new Error('heatmap requires data + x + y + value');
      break;
    case 'table':
      if (!Array.isArray(s.columns) || !Array.isArray(s.rows))
        throw new Error('table requires columns + rows');
      break;
  }
  return s as unknown as ChartSpec;
}

export function isShapeCompatibleSwap(from: ChartType, to: ChartType): boolean {
  // Bar/Line/Area share { x, y[] }
  const xy = new Set<ChartType>(['bar', 'line', 'area']);
  if (xy.has(from) && xy.has(to)) return true;
  // Pie ↔ table works (name/value <-> columns)
  if ((from === 'pie' && to === 'table') || (from === 'table' && to === 'pie')) return true;
  return from === to;
}
