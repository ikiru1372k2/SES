import type { FunctionId } from '../project/functions';

export const PROMPT_EXAMPLES: Record<FunctionId, string[]> = {
  'master-data': [
    "Flag projects where State is blank or contains 'Unknown'",
    'Flag rows where Project Manager is missing',
    "Flag rows where Project Product is 'Others' or 'TBD'",
    'Flag projects where Email is blank',
  ],
  'over-planning': [
    'Flag rows where Effort exceeds 200 hours',
    'Flag rows where Actual Hours exceed Planned Hours by more than 15 percent',
    'Flag rows where any month has effort over 80 hours',
  ],
  'missing-plan': [
    'Flag rows where Effort is zero',
    'Flag rows where Effort field is blank',
    'Flag projects with no planned months at all',
  ],
  'function-rate': [
    'Flag projects with zero rate in any of the last 3 months',
    'Flag projects whose rate is missing for the current quarter',
    'Flag rows where rate dropped to zero between Jan and Feb',
  ],
  'internal-cost-rate': [
    'Flag rows where any internal cost month is zero',
    'Flag projects where internal cost is blank',
    'Flag projects where Q1 internal cost dropped vs Q4 prior year',
  ],
  'opportunities': [
    'Flag opportunities whose close date is already in the past',
    'Flag Service category opportunities at 90% missing a BCS code',
    'Flag Brazil opportunities whose Business Unit is not Brazil',
  ],
};
