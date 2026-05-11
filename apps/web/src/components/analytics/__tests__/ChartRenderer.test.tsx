import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChartRenderer } from '../ChartRenderer';
import type { ChartSpec } from '@ses/domain';

describe('ChartRenderer heatmap', () => {
  it('ignores malformed heatmap rows instead of throwing', () => {
    const spec: ChartSpec = {
      type: 'heatmap',
      x: 'function',
      y: 'manager',
      value: 'count',
      data: [
        { function: 'Over Planning', manager: 'A', count: 2 },
        { function: null, manager: 'B', count: 5 },
        { function: 'Rate', manager: undefined, count: 1 },
      ],
      source: { row_count: 3, dataset_version: 'test', executed_at: '2026-05-11T00:00:00.000Z' },
    };

    render(<ChartRenderer spec={spec} />);

    expect(screen.getByText('Over Planning')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
