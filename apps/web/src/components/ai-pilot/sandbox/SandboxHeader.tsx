import { Sparkles } from 'lucide-react';

export interface SandboxHeaderProps {
  step: number;
}

export function SandboxHeader({ step }: SandboxHeaderProps) {
  const labels = ['Upload', 'Sheet', 'Describe', 'Generate', 'Review', 'Preview'];
  return (
    <header className="flex items-center justify-between border-b border-gray-100 px-6 py-3 dark:border-gray-800">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <Sparkles size={16} className="text-brand" />
        Author AI rule
      </div>
      <ol className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
        {labels.map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <li
              key={label}
              className={`rounded-full px-2 py-0.5 ${
                active
                  ? 'bg-brand text-white'
                  : done
                    ? 'bg-gray-100 text-gray-500 dark:bg-gray-800'
                    : 'text-gray-400'
              }`}
            >
              {n}. {label}
            </li>
          );
        })}
      </ol>
    </header>
  );
}
