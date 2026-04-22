import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  createEscalationTemplate,
  fetchEscalationTemplates,
  patchEscalationTemplate,
  type ApiEscalationTemplate,
} from '../lib/api/escalationTemplatesApi';
import { useCurrentUser } from '../components/auth/authContext';
import { Button } from '../components/shared/Button';

const SLOT_HELP = [
  '{managerFirstName}',
  '{processName}',
  '{findingsByEngine}',
  '{slaDeadline}',
  '{auditRunDate}',
  '{auditorName}',
];

export function EscalationTemplateAdmin() {
  const user = useCurrentUser();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<ApiEscalationTemplate | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [channel, setChannel] = useState('email');

  const listQ = useQuery({
    queryKey: ['escalation-templates-admin'],
    queryFn: () => fetchEscalationTemplates({ includeInactive: true }),
    enabled: user?.role === 'admin',
  });

  const byStage = useMemo(() => {
    const m = new Map<string, ApiEscalationTemplate[]>();
    for (const t of listQ.data ?? []) {
      const list = m.get(t.stage) ?? [];
      list.push(t);
      m.set(t.stage, list);
    }
    return m;
  }, [listQ.data]);

  const saveMut = useMutation({
    mutationFn: () => patchEscalationTemplate(selected!.id, { subject, body, channel }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['escalation-templates-admin'] });
      setSelected(t);
    },
  });

  const cloneMut = useMutation({
    mutationFn: (parent: ApiEscalationTemplate) =>
      createEscalationTemplate({
        parentId: parent.id,
        stage: parent.stage,
        subject: parent.subject,
        body: parent.body,
        channel: parent.channel,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['escalation-templates-admin'] }),
  });

  if (!user) return null;
  if (user.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Escalation templates</h1>
        <Link to="/" className="text-sm text-brand hover:underline">
          Home
        </Link>
      </div>
      <div className="flex gap-6">
        <div className="w-64 shrink-0 space-y-4">
          {[...byStage.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([stage, rows]) => (
              <div key={stage}>
                <div className="text-xs font-semibold uppercase text-gray-500">{stage}</div>
                <ul className="mt-1 space-y-1">
                  {rows.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(t);
                          setSubject(t.subject);
                          setBody(t.body);
                          setChannel(t.channel);
                        }}
                        className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${
                          selected?.id === t.id ? 'bg-gray-100 dark:bg-gray-800' : ''
                        }`}
                      >
                        {t.tenantId ? 'Org' : 'System'} v{t.version}
                        {!t.tenantId ? ' 🔒' : ''}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
        <div className="min-w-0 flex-1">
          {selected ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <label className="text-xs text-gray-500">Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={!selected.tenantId}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
                />
                <label className="mt-3 block text-xs text-gray-500">Body</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={!selected.tenantId}
                  rows={14}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                />
                <label className="mt-3 block text-xs text-gray-500">Channel</label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  disabled={!selected.tenantId}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
                >
                  <option value="email">email</option>
                  <option value="teams">teams</option>
                  <option value="both">both</option>
                </select>
                <div className="mt-4 flex gap-2">
                  {selected.tenantId ? (
                    <Button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                      Publish new version
                    </Button>
                  ) : (
                    <Button type="button" variant="secondary" onClick={() => cloneMut.mutate(selected)} disabled={cloneMut.isPending}>
                      Clone to customize
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500">Slots</div>
                <ul className="mt-2 space-y-1 font-mono text-xs text-gray-700 dark:text-gray-300">
                  {SLOT_HELP.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <div className="mt-4 rounded border border-gray-200 p-3 text-sm dark:border-gray-700">
                  <div className="text-xs text-gray-500">Preview (raw template — server substitutes on send)</div>
                  <div className="mt-2 font-medium">{subject}</div>
                  <pre className="mt-2 whitespace-pre-wrap text-xs">{body}</pre>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Select a template.</p>
          )}
        </div>
      </div>
    </div>
  );
}
