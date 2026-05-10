import { useMemo, useState } from 'react';
import type { ChartSpec, ChartType, Row } from '@ses/domain';
import { ChartRenderer } from './ChartRenderer';

const XY_TYPES: ChartType[] = ['bar', 'line', 'area'];

/**
 * A dashboard chart card with a built-in chart-type picker.
 * Pass `data` + `x` + `y` (single or array). The card internally swaps
 * between bar/line/area without reasking the API.
 *
 * For categorical breakdowns (one numeric per category), pass `pieKey` +
 * `pieValue` to also expose pie + table options.
 */
export function DashboardChartCard({
  title,
  description,
  data,
  x,
  y,
  pieKey,
  pieValue,
  defaultType = 'line',
  source,
}: {
  title: string;
  description?: string;
  data: Row[];
  x: string;
  y: string | string[];
  pieKey?: string;
  pieValue?: string;
  defaultType?: ChartType;
  source: { row_count: number; dataset_version: string };
}) {
  const allowed = useMemo<ChartType[]>(() => {
    const out: ChartType[] = [...XY_TYPES, 'table'];
    if (pieKey && pieValue) out.splice(3, 0, 'pie');
    return out;
  }, [pieKey, pieValue]);

  const [type, setType] = useState<ChartType>(defaultType);

  const spec = useMemo<ChartSpec>(() => {
    const meta = {
      source: { executed_at: new Date().toISOString(), row_count: source.row_count, dataset_version: source.dataset_version },
    };
    if (type === 'pie' && pieKey && pieValue) {
      return { type: 'pie', data, name: pieKey, value: pieValue, ...meta };
    }
    if (type === 'table') {
      const ys = Array.isArray(y) ? y : [y];
      const cols = [x, ...ys];
      return { type: 'table', columns: cols, rows: data, ...meta };
    }
    if (type === 'bar' || type === 'line' || type === 'area') {
      return { type, data, x, y, ...meta };
    }
    // Fallback to line
    return { type: 'line', data, x, y, ...meta };
  }, [type, data, x, y, pieKey, pieValue, source.row_count, source.dataset_version]);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {description ? <p className="text-xs text-gray-500">{description}</p> : null}
        </div>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ChartType)}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
          aria-label={`Chart type for ${title}`}
        >
          {allowed.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <ChartRenderer spec={spec} />
    </section>
  );
}
