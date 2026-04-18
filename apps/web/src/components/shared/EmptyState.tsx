import type { ReactNode } from 'react';

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-950 dark:text-white">{title}</h2>
      <div className="mt-2 max-w-xl text-sm text-gray-500 dark:text-gray-400">{children}</div>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
