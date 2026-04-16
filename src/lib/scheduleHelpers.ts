import type { AuditProcess } from './types';

export type ScheduleBucket = 'overdue' | 'dueThisWeek' | 'upcoming';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function daysUntilDue(nextAuditDue: string, now = new Date()): number {
  const due = startOfDay(new Date(nextAuditDue));
  const today = startOfDay(now);
  return Math.round((due.getTime() - today.getTime()) / DAY_MS);
}

export function scheduleBucket(process: AuditProcess, now = new Date()): ScheduleBucket | null {
  if (!process.nextAuditDue) return null;
  const days = daysUntilDue(process.nextAuditDue, now);
  if (days < 0) return 'overdue';
  if (days <= 7) return 'dueThisWeek';
  if (days <= 30) return 'upcoming';
  return null;
}

export function bucketedProcesses(processes: AuditProcess[], now = new Date()): Record<ScheduleBucket, AuditProcess[]> {
  const buckets: Record<ScheduleBucket, AuditProcess[]> = {
    overdue: [],
    dueThisWeek: [],
    upcoming: [],
  };
  processes.forEach((process) => {
    const bucket = scheduleBucket(process, now);
    if (bucket) buckets[bucket].push(process);
  });
  Object.values(buckets).forEach((items) => items.sort((a, b) => String(a.nextAuditDue).localeCompare(String(b.nextAuditDue))));
  return buckets;
}

export function isAuditDueSoon(process: AuditProcess, now = new Date()): boolean {
  if (!process.nextAuditDue) return false;
  return daysUntilDue(process.nextAuditDue, now) <= 7;
}

export function inferAuditCadenceDays(process: AuditProcess): number {
  const [latest, previous] = process.versions;
  if (!latest || !previous) return 30;
  const latestDate = startOfDay(new Date(latest.createdAt));
  const previousDate = startOfDay(new Date(previous.createdAt));
  const diff = Math.round(Math.abs(latestDate.getTime() - previousDate.getTime()) / DAY_MS);
  return diff >= 14 && diff <= 120 ? diff : 30;
}

export function nextDueDateAfterSave(process: AuditProcess, now = new Date()): string {
  const next = startOfDay(now);
  next.setDate(next.getDate() + inferAuditCadenceDays(process));
  return toDateInputValue(next);
}
