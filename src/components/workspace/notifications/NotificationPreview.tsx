import { auditIssueKey } from '../../../lib/auditEngine';
import { severityBarClass } from '../../../lib/severity';
import type { NotificationDraft, NotificationTemplate } from '../../../lib/types';

export function NotificationPreview({
  draft,
  deadline,
  template,
}: {
  draft: NotificationDraft;
  deadline: string;
  template: NotificationTemplate;
}) {
  return (
    <div className="mt-4 max-w-3xl font-sans text-sm text-gray-900 dark:text-gray-100">
      <p>Dear {draft.pmName},</p>
      <p className="mt-3">{template.intro}</p>
      <p className="mt-3">
        The following <strong>{draft.issueCount}</strong> project(s) require your attention:
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse border border-gray-300 text-xs dark:border-gray-600">
          <thead>
            <tr>
              {['Project No', 'Project', 'Severity', 'Notes', 'Proposed Effort', 'Correction Note', 'Auditor Comments', 'Status'].map((label) => (
                <th
                  key={label}
                  className="border border-gray-300 bg-gray-100 p-2 text-left font-semibold dark:border-gray-600 dark:bg-gray-700"
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
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">{issue.projectNo}</td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">{issue.projectName}</td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">
                    <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold text-white ${severityBarClass[issue.severity]}`}>
                      {issue.severity}
                    </span>
                  </td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">{issue.notes}</td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">
                    {correction ? (
                      <>
                        {issue.effort}h → <strong>{correction.effort ?? issue.effort}h</strong>
                      </>
                    ) : (
                      `${issue.effort}h`
                    )}
                  </td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">{correction?.note ?? ''}</td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">
                    {comments.map((c, ci) => (
                      <div key={ci}>{c.body}</div>
                    ))}
                  </td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">{statusLabel}</td>
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
