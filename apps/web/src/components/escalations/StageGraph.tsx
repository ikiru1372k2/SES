import { memo, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ProcessEscalationManagerRow } from '@ses/domain';
import { addStageComment, fetchStageComments } from '../../lib/api/trackingStageApi';

/**
 * Seven-node ladder shown at the top of the Activity tab (Issue #76).
 *
 * Each node has three possible states:
 *   - completed (green ✓): the underlying counter or stage says this step
 *     has already happened.
 *   - current  (blue ring): this is the node the cycle is resting on — the
 *     first unfinished step.
 *   - future   (grey outline): the step is ahead of the cycle; clicking it
 *     still opens the comment thread so auditors can note intent before
 *     the step actually lands ("will retry Thursday" etc).
 *
 * Clicking any node opens a side panel with the per-stage comment thread
 * scoped to `(trackingEntryId, stage)`. The thread is append-only.
 */

type StageKey = 'DRAFTED' | 'OUTLOOK_1' | 'OUTLOOK_2' | 'TEAMS' | 'RESPONDED' | 'VERIFIED' | 'RESOLVED';

interface StageNode {
  key: StageKey;
  label: string;
  completed: boolean;
}

function buildStages(row: ProcessEscalationManagerRow): StageNode[] {
  const outlook = row.outlookCount ?? 0;
  const teams = row.teamsCount ?? 0;
  const stage = row.stage ?? '';
  const responded = stage === 'RESPONDED' || Boolean(row.verifiedAt);
  const verified = Boolean(row.verifiedAt);
  const resolved = row.resolved === true || stage === 'RESOLVED';
  const drafted =
    stage === 'DRAFTED' ||
    stage === 'SENT' ||
    stage === 'AWAITING_RESPONSE' ||
    outlook >= 1 ||
    teams >= 1;

  return [
    { key: 'DRAFTED', label: 'Drafted', completed: drafted },
    { key: 'OUTLOOK_1', label: 'Outlook #1', completed: outlook >= 1 },
    { key: 'OUTLOOK_2', label: 'Outlook #2', completed: outlook >= 2 },
    { key: 'TEAMS', label: 'Teams', completed: teams >= 1 },
    { key: 'RESPONDED', label: 'Manager responded', completed: responded },
    { key: 'VERIFIED', label: 'Auditor verified', completed: verified },
    { key: 'RESOLVED', label: 'Resolved', completed: resolved && verified },
  ];
}

function currentNodeIndex(nodes: StageNode[]): number {
  for (let i = 0; i < nodes.length; i += 1) {
    if (!nodes[i]!.completed) return i;
  }
  return nodes.length - 1;
}

export const StageGraph = memo(function StageGraph({
  row,
  trackingIdOrCode,
}: {
  row: ProcessEscalationManagerRow;
  trackingIdOrCode: string;
}) {
  const [openStage, setOpenStage] = useState<StageKey | null>(null);
  const nodes = useMemo(() => buildStages(row), [row]);
  const current = currentNodeIndex(nodes);

  return (
    <div className="space-y-3">
      <ol className="flex flex-wrap items-center gap-1 text-[11px]">
        {nodes.map((node, index) => {
          const status: 'done' | 'current' | 'future' = node.completed
            ? 'done'
            : index === current
            ? 'current'
            : 'future';
          return (
            <li key={node.key} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setOpenStage(node.key)}
                className={`group inline-flex items-center gap-1 rounded-full border px-2 py-1 transition ${
                  status === 'done'
                    ? 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100 dark:border-green-900 dark:bg-green-950 dark:text-green-200'
                    : status === 'current'
                    ? 'border-brand/40 bg-brand/5 text-brand ring-2 ring-brand/30'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'
                }`}
                title={`Open notes for ${node.label}`}
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full">
                  {status === 'done' ? <Check size={12} /> : <span>{index + 1}</span>}
                </span>
                <span>{node.label}</span>
              </button>
              {index < nodes.length - 1 ? (
                <span className={`h-px w-4 ${status === 'done' ? 'bg-green-300' : 'bg-gray-200 dark:bg-gray-700'}`} />
              ) : null}
            </li>
          );
        })}
      </ol>
      {openStage ? (
        <StageCommentThread
          trackingIdOrCode={trackingIdOrCode}
          stage={openStage}
          onClose={() => setOpenStage(null)}
        />
      ) : null}
    </div>
  );
});

function StageCommentThread({
  trackingIdOrCode,
  stage,
  onClose,
}: {
  trackingIdOrCode: string;
  stage: StageKey;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');

  const q = useQuery({
    queryKey: ['tracking-stage-comments', trackingIdOrCode, stage],
    queryFn: () => fetchStageComments(trackingIdOrCode, stage),
  });

  const addMut = useMutation({
    mutationFn: () => addStageComment(trackingIdOrCode, { stage, body: body.trim() }),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: ['tracking-stage-comments', trackingIdOrCode, stage] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-100">
          <MessageCircle size={14} /> {stage} notes
        </div>
        <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:underline">
          Close
        </button>
      </div>
      <ul className="mt-2 space-y-2 text-sm">
        {q.isLoading ? <li className="text-xs text-gray-500">Loading…</li> : null}
        {q.data && q.data.length === 0 ? (
          <li className="text-xs text-gray-500">No notes yet — add the first one below.</li>
        ) : null}
        {q.data?.map((c) => (
          <li key={c.id} className="rounded border border-gray-100 bg-gray-50 px-2 py-1 dark:border-gray-800 dark:bg-gray-900/60">
            <div className="text-[11px] text-gray-500">
              {c.authorName} · {new Date(c.createdAt).toLocaleString()}
            </div>
            <div className="whitespace-pre-wrap">{c.body}</div>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          addMut.mutate();
        }}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder={`Add a note for ${stage}…`}
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
        />
        <button
          type="submit"
          disabled={addMut.isPending || !body.trim()}
          className="rounded bg-brand px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Post
        </button>
      </form>
    </div>
  );
}
