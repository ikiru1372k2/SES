export interface EscalationLadderProps {
  outlookCount: number;
  teamsCount: number;
}

export function EscalationLadder({ outlookCount, teamsCount }: EscalationLadderProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
      <span className="font-medium">Ladder:</span>
      <span
        className={`rounded-full px-2 py-0.5 ${
          outlookCount >= 1
            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
            : 'bg-gray-100 dark:bg-gray-800'
        }`}
      >
        Outlook #1 {outlookCount >= 1 ? '✓' : ''}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 ${
          outlookCount >= 2
            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
            : 'bg-gray-100 dark:bg-gray-800'
        }`}
      >
        Outlook #2 {outlookCount >= 2 ? '✓' : ''}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 ${
          teamsCount >= 1
            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
            : 'bg-gray-100 dark:bg-gray-800'
        }`}
      >
        Teams {teamsCount >= 1 ? '✓' : ''}
      </span>
    </div>
  );
}
