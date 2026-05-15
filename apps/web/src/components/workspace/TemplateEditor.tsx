import { useState } from 'react';
import toast from 'react-hot-toast';
import type { NotificationComposeTemplate, NotificationTheme } from '../../lib/domain/types';
import { Button } from '../shared/Button';

const VARIABLES: Array<{ name: string; label: string }> = [
  { name: '{{manager}}', label: 'Manager name' },
  { name: '{{projectCount}}', label: 'Project count' },
  { name: '{{deadline}}', label: 'Deadline' },
  { name: '{{highSeverityCount}}', label: 'High severity count' },
  { name: '{{auditorName}}', label: 'Auditor name' },
];

const fieldLabels = {
  greeting: 'Greeting',
  intro: 'Introduction',
  actionLine: 'Action line',
  deadlineLine: 'Deadline phrase',
  closing: 'Closing',
  signature1: 'Signature line 1',
  signature2: 'Signature line 2',
} as const;

type FieldKey = keyof typeof fieldLabels;

export function TemplateEditor({
  template,
  theme,
  onChange,
  onSaveNamed,
}: {
  template: NotificationComposeTemplate;
  theme: NotificationTheme;
  onChange: (template: NotificationComposeTemplate) => void;
  onSaveNamed: (name: string) => void;
}) {
  const [focusField, setFocusField] = useState<FieldKey | null>(null);
  const [saveName, setSaveName] = useState('');

  function insertVariable(variable: string) {
    if (!focusField) {
      toast.error('Click inside a field first, then insert a variable');
      return;
    }
    const current = template[focusField];
    onChange({ ...template, [focusField]: `${current} ${variable}`.trim() });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="text-xs font-medium text-gray-500">Insert variable</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {VARIABLES.map((variable) => (
            <button
              key={variable.name}
              type="button"
              onClick={() => insertVariable(variable.name)}
              className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs font-mono hover:border-brand hover:text-brand dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              {variable.label}
            </button>
          ))}
        </div>
      </div>
      {(Object.keys(fieldLabels) as FieldKey[]).map((key) => (
        <div key={key}>
          <label className="block text-xs font-medium text-gray-500">{fieldLabels[key]}</label>
          {key === 'intro' || key === 'closing' ? (
            <textarea
              value={template[key]}
              onFocus={() => setFocusField(key)}
              onChange={(event) => onChange({ ...template, [key]: event.target.value })}
              rows={2}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          ) : (
            <input
              value={template[key]}
              onFocus={() => setFocusField(key)}
              onChange={(event) => onChange({ ...template, [key]: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          )}
        </div>
      ))}
      <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="text-xs font-medium text-gray-500">Save as named template</div>
        <div className="mt-2 flex gap-2">
          <input
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
            placeholder="Template name"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
          <Button
            size="sm"
            onClick={() => {
              if (!saveName.trim()) {
                toast.error('Name the template first');
                return;
              }
              onSaveNamed(`${theme}::${saveName.trim()}`);
              setSaveName('');
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
