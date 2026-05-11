import { useMemo } from 'react';
import { Fragment } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartSpec, Row } from '@ses/domain';

const PRIMARY = '#b00020'; // SES brand red
const SECONDARIES = ['#475569', '#0f766e', '#a16207', '#7c3aed', '#0891b2'];

function colourFor(idx: number): string {
  return idx === 0 ? PRIMARY : SECONDARIES[(idx - 1) % SECONDARIES.length] ?? PRIMARY;
}

function formatVal(v: unknown): string {
  if (typeof v === 'number') return v.toLocaleString();
  return String(v ?? '');
}

export function ChartRenderer({
  spec,
  onDatumClick,
}: {
  spec: ChartSpec;
  onDatumClick?: (datum: Record<string, unknown>) => void;
}) {
  if (spec.type === 'kpi') {
    return (
      <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{spec.label}</div>
        <div className="mt-2 text-3xl font-bold text-gray-950 dark:text-white">{formatVal(spec.value)}</div>
        {spec.delta != null ? (
          <div className={`mt-1 text-xs ${spec.delta > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {spec.delta > 0 ? '+' : ''}{spec.delta}
          </div>
        ) : null}
      </div>
    );
  }

  if (spec.type === 'table') {
    return (
      <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              {spec.columns.map((c) => (
                <th key={c} className="p-2 font-semibold text-gray-700 dark:text-gray-200">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, i) => (
              <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                {spec.columns.map((c) => (
                  <td key={c} className="p-2">{formatVal((row as Row)[c])}</td>
                ))}
              </tr>
            ))}
            {!spec.rows.length ? (
              <tr><td colSpan={spec.columns.length} className="p-3 text-center text-gray-500">No rows</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    );
  }

  if (spec.type === 'bar' || spec.type === 'line' || spec.type === 'area') {
    const ys = Array.isArray(spec.y) ? spec.y : [spec.y];
    const ChartCmp = spec.type === 'bar' ? BarChart : spec.type === 'line' ? LineChart : AreaChart;
    const handleClick = onDatumClick
      ? (e: { activePayload?: Array<{ payload?: Record<string, unknown> }> }) => {
          const datum = e?.activePayload?.[0]?.payload;
          if (datum) onDatumClick(datum);
        }
      : undefined;
    const clickProp = handleClick ? { onClick: handleClick as unknown as never } : {};
    return (
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <ChartCmp data={spec.data} {...clickProp}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={spec.x} />
            <YAxis />
            <Tooltip />
            {ys.map((y, i) =>
              spec.type === 'bar' ? (
                spec.stacked
                  ? <Bar key={y} dataKey={y} fill={colourFor(i)} stackId="a" />
                  : <Bar key={y} dataKey={y} fill={colourFor(i)} />
              ) : spec.type === 'line' ? (
                <Line key={y} type="monotone" dataKey={y} stroke={colourFor(i)} strokeWidth={2} dot={false} />
              ) : (
                <Area key={y} type="monotone" dataKey={y} stroke={colourFor(i)} fill={colourFor(i)} fillOpacity={0.25} />
              ),
            )}
          </ChartCmp>
        </ResponsiveContainer>
      </div>
    );
  }

  if (spec.type === 'pie') {
    return (
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <PieChart>
            <Tooltip />
            <Pie
              data={spec.data}
              dataKey={spec.value}
              nameKey={spec.name}
              outerRadius={90}
              label
            >
              {spec.data.map((_d, i) => (
                <Cell key={i} fill={colourFor(i)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (spec.type === 'scatter') {
    return (
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={spec.x} type="number" />
            <YAxis dataKey={spec.y} type="number" />
            <Tooltip />
            <Scatter data={spec.data} fill={PRIMARY} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (spec.type === 'heatmap') {
    return <HeatmapView spec={spec} />;
  }

  return <div className="text-xs text-red-700">Unsupported chart type: {(spec as { type: string }).type}</div>;
}

function HeatmapView({ spec }: { spec: Extract<ChartSpec, { type: 'heatmap' }> }) {
  const { xs, ys, grid, max } = useMemo(() => {
    const validRows = (spec.data as Row[]).filter(
      (row) => row[spec.x] !== null && row[spec.x] !== undefined && row[spec.y] !== null && row[spec.y] !== undefined,
    );
    const xs = Array.from(new Set(validRows.map((d) => String(d[spec.x]))));
    const ys = Array.from(new Set(validRows.map((d) => String(d[spec.y]))));
    let max = 0;
    const grid: number[][] = ys.map(() => xs.map(() => 0));
    for (const r of validRows) {
      const xi = xs.indexOf(String(r[spec.x]));
      const yi = ys.indexOf(String(r[spec.y]));
      if (xi < 0 || yi < 0) continue;
      const v = Number(r[spec.value]) || 0;
      grid[yi]![xi] = v;
      if (v > max) max = v;
    }
    return { xs, ys, grid, max };
  }, [spec]);

  return (
    <div className="overflow-auto">
      <div className="inline-grid" style={{ gridTemplateColumns: `auto ${'1fr '.repeat(xs.length)}` }}>
        <div />
        {xs.map((x) => (
          <div key={x} className="px-2 text-xs font-medium text-gray-600">{x}</div>
        ))}
        {ys.map((y, yi) => (
          <Fragment key={y}>
            <div className="px-2 text-xs font-medium text-gray-600">{y}</div>
            {xs.map((x, xi) => {
              const v = grid[yi]![xi]!;
              const intensity = max ? v / max : 0;
              return (
                <div
                  key={`${y}-${x}`}
                  title={`${y} × ${x}: ${v}`}
                  className="h-10 w-10 border border-white text-center text-[10px] leading-10"
                  style={{ backgroundColor: `rgba(176,0,32,${intensity})`, color: intensity > 0.5 ? 'white' : '#1f2937' }}
                >
                  {v || ''}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
