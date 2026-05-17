export function PreviewPane({
  subject,
  body,
  bodyHtml,
  deadlineAt,
}: {
  subject: string;
  body: string;
  /** HTML rendering of the body — preferred over plain text when present. */
  bodyHtml?: string;
  deadlineAt?: string | null;
}) {
  const hasHtml = Boolean(bodyHtml && bodyHtml.trim().length > 0);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm shadow-soft dark:border-gray-800 dark:bg-gray-900">
      <div className="eyebrow">Subject</div>
      <div className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
        {subject || '(empty)'}
      </div>
      {deadlineAt ? (
        <>
          <div className="eyebrow mt-3">
            Due date
          </div>
          <div className="mt-1 text-gray-900 dark:text-white">
            {new Date(deadlineAt).toLocaleDateString()}
          </div>
        </>
      ) : null}
      <div className="eyebrow mt-4 border-t border-gray-200 pt-3 dark:border-gray-800">
        Body
      </div>
      {hasHtml ? (
        <div
          className="email-preview mt-2 rounded-lg border border-gray-100 bg-white p-3 text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          // The HTML is generated server-side by tracking-compose.service —
          // every dynamic field is escaped before it goes into the markup,
          // so this is safe to render as-is.
          dangerouslySetInnerHTML={{ __html: bodyHtml! }}
        />
      ) : (
        <pre className="mt-2 whitespace-pre-wrap font-sans text-gray-800 dark:text-gray-200">
          {body || '(empty)'}
        </pre>
      )}
    </div>
  );
}
