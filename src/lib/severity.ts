import type { Severity } from './types';

export const severityTone: Record<Severity, 'red' | 'amber' | 'blue'> = {
  High: 'red',
  Medium: 'amber',
  Low: 'blue',
};

export const severityBarClass: Record<Severity, string> = {
  High: 'bg-red-600',
  Medium: 'bg-amber-600',
  Low: 'bg-blue-600',
};
