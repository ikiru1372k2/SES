import { Button } from '../../shared/Button';

export interface EmailHeaderProps {
  managerName: string;
  managerEmail: string | null | undefined;
  cc: string[];
  ccInput: string;
  readOnly: boolean;
  onCcInputChange: (value: string) => void;
  onAddCc: () => void;
  onRemoveCc: (email: string) => void;
}

export function EmailHeader({
  managerName,
  managerEmail,
  cc,
  ccInput,
  readOnly,
  onCcInputChange,
  onAddCc,
  onRemoveCc,
}: EmailHeaderProps) {
  return (
    <>
      <div>
        <div className="text-xs font-medium text-gray-500">To</div>
        <div className="mt-1 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900">
          {managerName} &lt;{managerEmail ?? '—'}&gt;
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-gray-500">CC</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {cc.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800"
            >
              {c}
              {!readOnly ? (
                <button
                  type="button"
                  className="text-gray-500 hover:text-red-600"
                  onClick={() => onRemoveCc(c)}
                  aria-label={`Remove ${c}`}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
        {!readOnly ? (
          <div className="mt-2 flex gap-2">
            <input
              value={ccInput}
              onChange={(e) => onCcInputChange(e.target.value)}
              placeholder="email@company.com"
              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
            <Button type="button" variant="secondary" onClick={onAddCc}>
              Add
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
