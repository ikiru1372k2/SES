export function PreviewPane({
  subject,
  body,
  deadlineAt,
}: {
  subject: string;
  body: string;
  deadlineAt?: string | null;
}) {
  return (
    <div className="rounded border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="text-xs font-medium text-gray-500">Subject</div>
      <div className="mt-1 font-medium text-gray-900 dark:text-white">{subject || '(empty)'}</div>
      {deadlineAt ? (
        <>
          <div className="mt-3 text-xs font-medium text-gray-500">Due date</div>
          <div className="mt-1 text-gray-900 dark:text-white">
            {new Date(deadlineAt).toLocaleDateString()}
          </div>
        </>
      ) : null}
      <div className="mt-3 text-xs font-medium text-gray-500">Body</div>
      <pre className="mt-1 whitespace-pre-wrap font-sans text-gray-800 dark:text-gray-200">{body || '(empty)'}</pre>
    </div>
  );
}
