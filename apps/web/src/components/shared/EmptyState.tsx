import type { ReactNode } from 'react';

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-[18rem] flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center shadow-soft dark:border-gray-700 dark:bg-gray-900">
      <h2 className="text-lg font-semibold tracking-tight text-gray-950 dark:text-white">{title}</h2>
      <div className="mt-2 max-w-xl text-sm text-gray-500 dark:text-gray-400">{children}</div>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
