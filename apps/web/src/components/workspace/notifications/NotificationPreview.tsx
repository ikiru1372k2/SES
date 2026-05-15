import { auditIssueKey } from '../../../lib/domain/auditEngine';
import { severityBarClass } from '../../../lib/domain/severity';
import type { NotificationDraft, NotificationComposeTemplate } from '../../../lib/domain/types';

export function NotificationPreview({
  draft,
  deadline,
  template,
}: {
  draft: NotificationDraft;
  deadline: string;
  template: NotificationComposeTemplate;
}) {
  return (
    <div className="mt-4 max-w-3xl font-sans text-sm text-gray-900 dark:text-gray-100">
      <p>Dear {draft.pmName},</p>
      <p className="mt-3">{template.intro}</p>
      <p className="mt-3">
        The following <strong>{draft.issueCount}</strong> project(s) require your attention:
      </p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full min-w-[720px] border-collapse text-xs">
          <thead>
            <tr>
              {['Project No', 'Project', 'Severity', 'Reason', 'Effort', 'Status'].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="border-b border-gray-200 bg-gray-100 p-2 text-left font-semibold dark:border-gray-700 dark:bg-gray-700"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.projects.map((issue, index) => {
              const key = auditIssueKey(issue);
              const correction = draft.corrections[key];
              const comments = draft.comments[key] ?? [];
              const ack = draft.acknowledgments[key];
              const statusLabel = ack
                ? ack.status === 'corrected'
                  ? 'Corrected'
                  : ack.status === 'acknowledged'
                    ? 'Acknowledged'
                    : 'Needs review'
                : 'Needs review';
              const rowBg = index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900';

              return (
                <tr key={issue.id} className={rowBg}>
                  <td className="border-b border-gray-100 p-2 align-top dark:border-gray-700">{issue.projectNo}</td>
                  <td className="border-b border-gray-100 p-2 align-top dark:border-gray-700">{issue.projectName}</td>
                  <td className="border-b border-gray-100 p-2 align-top dark:border-gray-700">
                    <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold text-white ${severityBarClass[issue.severity]}`}>
                      {issue.severity}
                    </span>
                  </td>
                  <td className="border-b border-gray-100 p-2 align-top dark:border-gray-700">{issue.reason ?? issue.notes}</td>
                  <td className="border-b border-gray-100 p-2 align-top dark:border-gray-700">
                    {correction ? (
                      <>
                        {issue.effort}h -&gt; <strong>{correction.effort ?? issue.effort}h</strong>
                      </>
                    ) : (
                      `${issue.effort}h`
                    )}
                  </td>
                  <td className="border-b border-gray-100 p-2 align-top dark:border-gray-700">
                    {statusLabel}
                    {correction?.note ? <div className="mt-1 text-[11px] text-gray-500">{correction.note}</div> : null}
                    {comments.length ? <div className="mt-1 text-[11px] text-gray-500">{comments.length} auditor comment(s)</div> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-4">
        {template.actionLine} by <strong>{deadline || 'the agreed deadline'}</strong>.
      </p>
      <p className="mt-3">{template.closing}</p>
      <p className="mt-6 text-gray-500">
        {template.signature1}
        <br />
        {template.signature2}
      </p>
    </div>
  );
}
