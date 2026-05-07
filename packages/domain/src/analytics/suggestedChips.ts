import type { FunctionId } from '../functions';

/** Chips shown in the chat empty state — keyed by scope. */
export const SUGGESTED_CHIPS: Record<FunctionId | 'process', string[]> = {
  process: [
    'Which function is in worst shape this week?',
    'Compare this week to last week',
    'Top 5 managers blocking sign-off',
    'Which functions have stale data?',
  ],
  'master-data': [
    'Which projects have missing PSU Relevant?',
    'Where do we have unmapped managers?',
    'Top managers by master-data issues',
  ],
  'over-planning': [
    'Show chronic slow responders',
    'Effort spikes greater than 200 hours since last version',
    'Top 5 overplanned projects this week',
  ],
  'missing-plan': [
    'Which managers have the most missing plans this cycle?',
    'Plans missing more than two weeks',
    'Trend of missing plans over last 4 versions',
  ],
  'function-rate': [
    'Cost-rate outliers by department',
    'Month-over-month rate changes',
    'Top 5 high-rate functions',
  ],
  'internal-cost-rate': [
    'ICR variance vs function-rate by project',
    'Top 5 ICR overruns',
    'Projects with negative cost gap',
  ],
  opportunities: [
    'Opportunities at risk this quarter',
    'Stale opportunities not contacted in 30 days',
    'Top customers by open opportunity count',
  ],
};

export function chipsForScope(functionId: FunctionId | undefined): string[] {
  return SUGGESTED_CHIPS[functionId ?? 'process'] ?? SUGGESTED_CHIPS.process;
}
