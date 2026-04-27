import type React from 'react';

export const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {children}
    </label>
  );
}

export function FooterRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-2">{children}</div>;
}

export function SeverityChip({ s }: { s: 'High' | 'Medium' | 'Low' }) {
  const cls =
    s === 'High'
      ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200'
      : s === 'Medium'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-200';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{s}</span>
  );
}
