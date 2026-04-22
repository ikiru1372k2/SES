import { useState } from 'react';
import { parseTsvRows, detectColumnMapping, type DirectoryRowInput } from '@ses/domain';

export function PasteFromExcel({
  onParsed,
}: {
  onParsed: (rows: DirectoryRowInput[]) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  function parse() {
    setError(null);
    try {
      const { headers, rows } = parseTsvRows(text);
      if (!headers.length) {
        setError('Paste tab-separated rows with a header row first.');
        return;
      }
      const map = detectColumnMapping(headers);
      if (!map.firstName || !map.lastName || !map.email) {
        setError('Could not detect first name, last name, and email columns from the header row.');
        return;
      }
      const fnKey = map.firstName;
      const lnKey = map.lastName;
      const emKey = map.email;
      const out: DirectoryRowInput[] = rows.map((r) => ({
        firstName: String(r[fnKey] ?? '').trim(),
        lastName: String(r[lnKey] ?? '').trim(),
        email: String(r[emKey] ?? '').trim(),
      }));
      onParsed(out);
    } catch {
      setError('Could not parse pasted data.');
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Paste from Excel</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        className="w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-900"
        placeholder="Paste rows (tab-separated), including header…"
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="button"
        onClick={() => parse()}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:hover:bg-gray-800"
      >
        Parse
      </button>
    </div>
  );
}
