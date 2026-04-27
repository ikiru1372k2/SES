import { useRef, type ChangeEvent } from 'react';
import { Upload } from 'lucide-react';

export interface Step1UploadProps {
  busy: boolean;
  onPick: (file: File) => void;
}

export function Step1Upload({ busy, onPick }: Step1UploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Drop a sample workbook (.xlsx, max 5MB). Production files are never touched — this is a
        private sandbox.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-sm font-medium text-gray-700 transition hover:border-brand hover:bg-brand-subtle hover:text-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
      >
        <Upload size={18} />
        {busy ? 'Uploading…' : 'Choose .xlsx file'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        hidden
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
    </div>
  );
}
