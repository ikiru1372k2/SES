import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { FooterRow } from './shared';

export interface Step2PickSheetProps {
  sheets: Array<{ name: string; rowCount: number; status: string }>;
  selected: string | null;
  busy: boolean;
  onPick: (name: string) => void;
}

export function Step2PickSheet({ sheets, selected, busy, onPick }: Step2PickSheetProps) {
  const [choice, setChoice] = useState(selected ?? sheets[0]?.name ?? '');
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Multiple sheets detected. Pick the one this rule applies to.
      </p>
      <div className="space-y-1.5">
        {sheets.map((s) => (
          <label
            key={s.name}
            className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
              choice === s.name
                ? 'border-brand bg-brand-subtle text-brand'
                : 'border-gray-200 hover:border-gray-300 dark:border-gray-700'
            }`}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="sheet"
                value={s.name}
                checked={choice === s.name}
                onChange={() => setChoice(s.name)}
                className="accent-brand"
              />
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-gray-500">
                {s.rowCount} rows · {s.status}
              </span>
            </span>
          </label>
        ))}
      </div>
      <FooterRow>
        <button
          type="button"
          disabled={busy || !choice}
          onClick={() => onPick(choice)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Continue'}
          <ChevronRight size={14} className="ml-1 inline" />
        </button>
      </FooterRow>
    </div>
  );
}
