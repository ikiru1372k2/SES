import type { ProcessEscalationManagerRow } from '@ses/domain';
import { effectiveManagerEmail } from './nextAction';
import {
  ComposerFooter,
  EditPane,
  EmailHeader,
  EscalationLadder,
  TemplateControls,
} from './composer';
import { useComposerState } from './composer/useComposerState';

export function Composer({
  processDisplayCode,
  row,
  onDone,
}: {
  processDisplayCode: string;
  row: ProcessEscalationManagerRow;
  onDone: () => void;
}) {
  const trackingRef = row.trackingId ?? row.trackingDisplayCode;
  const managerEmail = effectiveManagerEmail(row);

  const s = useComposerState({ processDisplayCode, row, trackingRef, onDone });

  // Hooks MUST be called unconditionally and before any early return.
  if (!trackingRef) {
    return <p className="text-sm text-amber-700">No tracking row yet — save tracking from the workspace first.</p>;
  }

  return (
    <div className="space-y-4">
      {s.readOnly ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          Being edited by {s.statusQ.data?.lockedBy ?? 'another user'} until{' '}
          {s.statusQ.data?.lockedUntil
            ? new Date(s.statusQ.data.lockedUntil).toLocaleString()
            : '—'}
        </div>
      ) : null}
      {s.dirtyWarn ? (
        <div className="flex items-center justify-between rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950">
          <span>You edited the body. Changing template will replace content.</span>
          <button type="button" className="text-brand underline" onClick={() => s.setDirtyWarn(false)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <EscalationLadder outlookCount={s.outlookCount} teamsCount={s.teamsCount} />

      <EmailHeader
        managerName={row.managerName}
        managerEmail={managerEmail}
        cc={s.cc}
        ccInput={s.ccInput}
        readOnly={s.readOnly}
        onCcInputChange={s.setCcInput}
        onAddCc={s.addCc}
        onRemoveCc={(email) => void s.removeCc(email)}
      />

      <TemplateControls
        readOnly={s.readOnly}
        templateId={s.templateId}
        deadlineAt={s.deadlineAt}
        templates={s.templatesQ.data ?? []}
        uniqueProjectIds={s.uniqueProjectIds}
        cleanProjectLinks={s.cleanProjectLinks}
        projectLinks={s.projectLinks}
        projectLinksOpen={s.projectLinksOpen}
        countsByEngine={row.countsByEngine}
        findingsByEngine={row.findingsByEngine}
        removedEngines={s.removedEngines}
        onTemplateChange={s.onTemplateChange}
        onDeadlineChange={s.setDeadlineAt}
        onProjectLinksOpenToggle={() => s.setProjectLinksOpen((v) => !v)}
        onProjectLinkChange={(pid, url) =>
          s.setProjectLinks((prev) => ({ ...prev, [pid]: url }))
        }
        onToggleEngineRemove={(fid, n) => void s.toggleEngineRemove(fid, n)}
      />

      <EditPane
        viewMode={s.viewMode}
        subject={s.subject}
        body={s.body}
        readOnly={s.readOnly}
        resolvedPreview={s.resolvedPreview}
        previewLoading={s.previewLoading}
        deadlineAt={s.deadlineAt}
        onSubjectChange={s.setSubject}
        onBodyChange={s.setBody}
      />

      <div>
        <label className="text-xs font-medium text-gray-500">
          Auditor note (internal — not shown to the manager)
        </label>
        <textarea
          disabled={s.readOnly}
          value={s.authorNote}
          onChange={(e) => s.setAuthorNote(e.target.value)}
          rows={2}
          placeholder="Why are you sending this now? e.g. 'tried calling twice, no answer'"
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
        />
      </div>

      <ComposerFooter
        viewMode={s.viewMode}
        readOnly={s.readOnly}
        outlookCount={s.outlookCount}
        teamsCount={s.teamsCount}
        outlookAllowed={s.outlookAllowed}
        teamsAllowed={s.teamsAllowed}
        outlookGateReason={s.outlookGateReason}
        teamsGateReason={s.teamsGateReason}
        discardPending={s.discardMut.isPending}
        draftPending={s.draftMut.isPending}
        sendPending={s.sendMut.isPending}
        onToggleView={() => s.setViewMode(s.viewMode === 'preview' ? 'edit' : 'preview')}
        onDiscard={() => s.discardMut.mutate()}
        onSaveDraft={() => s.draftMut.mutate(s.payload)}
        onSendOutlook={() => s.sendMut.mutate('email')}
        onSendTeams={() => s.sendMut.mutate('teams')}
      />
    </div>
  );
}
