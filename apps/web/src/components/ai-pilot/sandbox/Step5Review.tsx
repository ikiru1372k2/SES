import type { AiRuleSpec, IssueCategory, Severity } from '@ses/domain';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Field, FooterRow, inputClass } from './shared';

const SEVERITIES: Severity[] = ['High', 'Medium', 'Low'];
const CATEGORIES: IssueCategory[] = [
  'Data Quality',
  'Needs Review',
  'Missing Data',
  'Effort Threshold',
  'Planning Risk',
  'Capacity Risk',
  'Overplanning',
  'Missing Planning',
  'Function Rate',
  'Internal Cost Rate',
  'Other',
];

export interface Step5ReviewProps {
  spec: AiRuleSpec;
  onChange: (patch: Partial<AiRuleSpec>) => void;
  onBack: () => void;
  onPreview: () => void;
  busy: boolean;
}

export function Step5Review({ spec, onChange, onBack, onPreview, busy }: Step5ReviewProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Review what the AI generated. You can edit any field. Editing forces a re-preview.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Name">
          <input
            value={spec.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Severity">
          <select
            value={spec.severity}
            onChange={(e) => onChange({ severity: e.target.value as Severity })}
            className={inputClass}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select
            value={spec.category}
            onChange={(e) => onChange({ category: e.target.value as IssueCategory })}
            className={inputClass}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Flag message (interpolates {projectNo}, {projectName}, {projectManager})">
          <input
            value={spec.flagMessage}
            onChange={(e) => onChange({ flagMessage: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Logic (JSON)">
        <textarea
          value={JSON.stringify(spec.logic, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              onChange({ logic: parsed });
            } catch {
              /* ignore until valid */
            }
          }}
          rows={6}
          className={`${inputClass} font-mono text-[11px]`}
        />
      </Field>
      <FooterRow>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700"
        >
          <ChevronLeft size={14} className="mr-1 inline" />
          Refine prompt
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onPreview}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {busy ? 'Previewing…' : 'Preview against sample'}
          <ChevronRight size={14} className="ml-1 inline" />
        </button>
      </FooterRow>
    </div>
  );
}
