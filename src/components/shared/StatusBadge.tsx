import { Badge } from './Badge';

export function StatusBadge({ value }: { value: string }) {
  const key = value.toLowerCase();
  const tone = key.includes('valid') || key.includes('audited') ? 'green' : key.includes('duplicate') || key.includes('medium') ? 'amber' : key.includes('invalid') || key.includes('high') ? 'red' : key.includes('low') ? 'blue' : 'gray';
  return <Badge tone={tone}>{value}</Badge>;
}
