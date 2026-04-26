import { Sparkles } from 'lucide-react';

export function AiBadge({ tooltip }: { tooltip?: string }) {
  return (
    <span
      title={tooltip}
      className="inline-flex items-center gap-1 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
    >
      <Sparkles size={10} />
      AI
    </span>
  );
}
