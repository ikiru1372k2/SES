import type { AiRuleOperator } from './types';

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const parsed = Number(String(v ?? '').trim());
  return Number.isFinite(parsed) ? parsed : NaN;
};

const text = (v: unknown): string => String(v ?? '').trim();

const isBlank = (v: unknown): boolean => v == null || text(v) === '';

export type OperatorContext = {
  cell: unknown;
  value: unknown;
  values: unknown[] | undefined;
  compareCell: unknown;
};

type LeafOperator = Exclude<AiRuleOperator, never>;

export const OPERATORS: Record<LeafOperator, (ctx: OperatorContext) => boolean> = {
  '>': ({ cell, value }) => {
    const a = num(cell);
    const b = num(value);
    return Number.isFinite(a) && Number.isFinite(b) && a > b;
  },
  '<': ({ cell, value }) => {
    const a = num(cell);
    const b = num(value);
    return Number.isFinite(a) && Number.isFinite(b) && a < b;
  },
  '>=': ({ cell, value }) => {
    const a = num(cell);
    const b = num(value);
    return Number.isFinite(a) && Number.isFinite(b) && a >= b;
  },
  '<=': ({ cell, value }) => {
    const a = num(cell);
    const b = num(value);
    return Number.isFinite(a) && Number.isFinite(b) && a <= b;
  },
  '==': ({ cell, value }) => text(cell).toLowerCase() === text(value).toLowerCase(),
  '!=': ({ cell, value }) => text(cell).toLowerCase() !== text(value).toLowerCase(),
  '%>': ({ cell, value, compareCell }) => {
    const a = num(cell);
    const base = num(compareCell);
    const pct = num(value);
    if (!Number.isFinite(a) || !Number.isFinite(base) || base === 0 || !Number.isFinite(pct)) {
      return false;
    }
    return ((a - base) / base) * 100 > pct;
  },
  contains: ({ cell, value }) => text(cell).toLowerCase().includes(text(value).toLowerCase()),
  startsWith: ({ cell, value }) =>
    text(cell).toLowerCase().startsWith(text(value).toLowerCase()),
  endsWith: ({ cell, value }) =>
    text(cell).toLowerCase().endsWith(text(value).toLowerCase()),
  isBlank: ({ cell }) => isBlank(cell),
  isOneOf: ({ cell, values }) =>
    Array.isArray(values) && values.map((v) => text(v).toLowerCase()).includes(text(cell).toLowerCase()),
  isMissing: ({ cell }) => isBlank(cell),
  isNotMissing: ({ cell }) => !isBlank(cell),
};
