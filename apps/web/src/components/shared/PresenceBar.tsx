import type { PresenceMember } from '../../realtime/types';

const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-fuchsia-500',
  'bg-teal-500',
  'bg-orange-500',
];

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0] ?? '';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? '';
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || '?';
}

function colorFor(userCode: string): string {
  let hash = 0;
  for (let i = 0; i < userCode.length; i++) {
    hash = (hash * 31 + userCode.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? 'bg-gray-500';
}

interface PresenceBarProps {
  members: PresenceMember[];
  selfCode: string | undefined;
  /** Cap shown avatars; overflow rendered as "+N". */
  max?: number;
}

export function PresenceBar({ members, selfCode, max = 4 }: PresenceBarProps) {
  if (!members.length) return null;

  // De-duplicate by userCode: same user in multiple tabs shows one avatar.
  const uniqueByUser = new Map<string, PresenceMember>();
  for (const m of members) {
    if (!uniqueByUser.has(m.userCode)) uniqueByUser.set(m.userCode, m);
  }
  const unique = Array.from(uniqueByUser.values());

  // Sort: self last so others are more visible; otherwise alphabetic by name.
  unique.sort((a, b) => {
    if (a.userCode === selfCode) return 1;
    if (b.userCode === selfCode) return -1;
    return a.displayName.localeCompare(b.displayName);
  });

  const visible = unique.slice(0, max);
  const overflow = Math.max(0, unique.length - visible.length);

  return (
    <div
      className="flex items-center"
      aria-label={`${unique.length} member${unique.length === 1 ? '' : 's'} active`}
    >
      <div className="flex -space-x-2">
        {visible.map((member) => (
          <span
            key={member.userCode}
            title={`${member.displayName}${member.userCode === selfCode ? ' (you)' : ''}`}
            className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold text-white shadow-sm dark:border-gray-900 ${colorFor(
              member.userCode,
            )}`}
          >
            {initialsFromName(member.displayName)}
          </span>
        ))}
        {overflow > 0 ? (
          <span
            title={`${overflow} more`}
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gray-300 text-[11px] font-semibold text-gray-700 shadow-sm dark:border-gray-900 dark:bg-gray-700 dark:text-gray-100"
          >
            +{overflow}
          </span>
        ) : null}
      </div>
      <span className="ml-2 hidden text-xs text-gray-500 sm:inline">
        {unique.length} here
      </span>
    </div>
  );
}
