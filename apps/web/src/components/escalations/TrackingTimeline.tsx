import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Clock,
  type LucideIcon,
  Mail,
  MessageSquare,
  PauseCircle,
  RefreshCcw,
  Send,
  Users,
  Zap,
} from 'lucide-react';
import { useMemo } from 'react';
import type { TrackingEventDto } from '../../lib/api/escalationsApi';

type Tone = 'gray' | 'blue' | 'amber' | 'emerald' | 'red' | 'violet';

interface RenderedEvent {
  id: string;
  displayCode: string;
  at: string;
  title: string;
  subtitle: string | null;
  note: string | null;
  tone: Tone;
  Icon: LucideIcon;
  channel: string | null;
  actorName: string | null;
  actorEmail: string | null;
  synthetic: boolean;
}

// Single source of truth for per-event rendering; add a new event kind here.
const EVENT_STYLE: Record<string, { label: string; tone: Tone; Icon: LucideIcon }> = {
  escalation_sent:    { label: 'Escalation sent',      tone: 'blue',    Icon: Send },
  contact:            { label: 'Contact logged',       tone: 'gray',    Icon: MessageSquare },
  stage_transition:   { label: 'Stage changed',        tone: 'violet',  Icon: RefreshCcw },
  sla_snoozed:        { label: 'SLA snoozed',          tone: 'amber',   Icon: PauseCircle },
  sla_draft_queued:   { label: 'SLA breach — follow-up queued', tone: 'amber', Icon: AlertTriangle },
  bulk_snooze:        { label: 'Bulk snooze',          tone: 'amber',   Icon: PauseCircle },
  bulk_acknowledge:   { label: 'Acknowledged',         tone: 'emerald', Icon: CheckCircle2 },
  bulk_reescalate:    { label: 'Re-escalated',         tone: 'red',     Icon: ArrowUpCircle },
  manager_response:   { label: 'Manager responded',    tone: 'emerald', Icon: Users },
  broadcast_sent:     { label: 'Global broadcast prepared', tone: 'blue', Icon: Send },
  broadcast_prepared: { label: 'Global broadcast prepared', tone: 'blue', Icon: Send },
  broadcast_skipped:  { label: 'Broadcast skipped', tone: 'amber', Icon: AlertTriangle },
  broadcast_failed:   { label: 'Broadcast failed', tone: 'red', Icon: AlertTriangle },
  escalation_reminder:{ label: 'Reminder sent',        tone: 'blue',    Icon: Mail },
  resolved:           { label: 'Resolved',             tone: 'emerald', Icon: CheckCircle2 },
  verified:           { label: 'Verified',             tone: 'emerald', Icon: CheckCircle2 },
  auto_escalated:     { label: 'Auto-escalated',       tone: 'red',     Icon: Zap },
  // Synthetic event kinds (backfilled from entry counters).
  CREATED:            { label: 'Entry created',        tone: 'gray',    Icon: Clock },
  INITIAL_CONTACT:    { label: 'Initial contact',      tone: 'blue',    Icon: Mail },
  FOLLOW_UP:          { label: 'Follow-up sent',       tone: 'blue',    Icon: Mail },
  TEAMS_MESSAGE:      { label: 'Teams message',        tone: 'violet',  Icon: MessageSquare },
  TEAMS_FOLLOW_UP:    { label: 'Teams follow-up',      tone: 'violet',  Icon: MessageSquare },
  ESCALATED:          { label: 'Escalated',            tone: 'red',     Icon: ArrowUpCircle },
  MANAGER_RESPONDED:  { label: 'Manager responded',    tone: 'emerald', Icon: Users },
  VERIFIED:           { label: 'Verified',             tone: 'emerald', Icon: CheckCircle2 },
  RESOLVED:           { label: 'Resolved',             tone: 'emerald', Icon: CheckCircle2 },
};

const TONE_CLASSES: Record<Tone, { ring: string; iconBg: string; icon: string; chip: string; bar: string }> = {
  gray:    { ring: 'ring-gray-200 dark:ring-gray-700',       iconBg: 'bg-gray-50 dark:bg-gray-900',        icon: 'text-gray-500',    chip: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',       bar: 'bg-gray-300' },
  blue:    { ring: 'ring-blue-200 dark:ring-blue-900',       iconBg: 'bg-blue-50 dark:bg-blue-950',        icon: 'text-blue-600',    chip: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',        bar: 'bg-blue-400' },
  amber:   { ring: 'ring-amber-200 dark:ring-amber-900',     iconBg: 'bg-amber-50 dark:bg-amber-950',      icon: 'text-amber-600',   chip: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',    bar: 'bg-amber-400' },
  emerald: { ring: 'ring-emerald-200 dark:ring-emerald-900', iconBg: 'bg-emerald-50 dark:bg-emerald-950',  icon: 'text-emerald-600', chip: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200', bar: 'bg-emerald-400' },
  red:     { ring: 'ring-red-200 dark:ring-red-900',         iconBg: 'bg-red-50 dark:bg-red-950',          icon: 'text-red-600',     chip: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',            bar: 'bg-red-400' },
  violet:  { ring: 'ring-violet-200 dark:ring-violet-900',   iconBg: 'bg-violet-50 dark:bg-violet-950',    icon: 'text-violet-600',  chip: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200', bar: 'bg-violet-400' },
};

const CHANNEL_LABEL: Record<string, string> = {
  email: 'Email',
  outlook: 'Outlook',
  teams: 'Teams',
  both: 'Email + Teams',
  manual: 'Manual',
  stage_transition: 'System',
  sla: 'SLA cron',
  api: 'API',
};

function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const delta = t - now;
  const abs = Math.abs(delta);
  const sec = Math.round(abs / 1000);
  if (sec < 30) return 'just now';
  const m = Math.round(abs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return delta < 0 ? `${m}m ago` : `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return delta < 0 ? `${h}h ago` : `in ${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return delta < 0 ? `${d}d ago` : `in ${d}d`;
  const mo = Math.round(d / 30);
  return delta < 0 ? `${mo}mo ago` : `in ${mo}mo`;
}

function absoluteTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function dayBucketLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const evDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((today - evDay) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

function summarize(event: TrackingEventDto): RenderedEvent {
  const reasonKey = event.reason && EVENT_STYLE[event.reason] ? event.reason : null;
  const kindKey = EVENT_STYLE[event.kind] ? event.kind : null;
  const styleKey = reasonKey ?? kindKey;
  const style = styleKey
    ? EVENT_STYLE[styleKey]!
    : { label: humanizeKind(event.kind), tone: 'gray' as Tone, Icon: Clock };

  let subtitle: string | null = null;
  if (event.kind === 'stage_transition' && event.payload && typeof event.payload === 'object') {
    const payload = event.payload as { previousStage?: string; nextStage?: string };
    if (payload.previousStage && payload.nextStage) {
      subtitle = `${humanizeStage(payload.previousStage)} → ${humanizeStage(payload.nextStage)}`;
    }
  }

  return {
    id: event.id,
    displayCode: event.displayCode,
    at: event.at,
    title: style.label,
    subtitle,
    note: event.note?.trim() || null,
    tone: style.tone,
    Icon: style.Icon,
    channel: event.channel && event.channel !== 'manual' && event.channel !== 'system' ? event.channel : null,
    actorName: event.triggeredByName ?? null,
    actorEmail: event.triggeredByEmail ?? null,
    synthetic: event.synthetic ?? false,
  };
}

function humanizeKind(kind: string): string {
  if (!kind) return 'Event';
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeStage(stage: string): string {
  switch (stage) {
    case 'NEW': return 'New';
    case 'DRAFTED': return 'Drafted';
    case 'SENT': return 'Sent';
    case 'AWAITING_RESPONSE': return 'Awaiting Response';
    case 'RESPONDED': return 'Responded';
    case 'NO_RESPONSE': return 'No Response';
    case 'ESCALATED_L1': return 'Escalated L1';
    case 'ESCALATED_L2': return 'Escalated L2';
    case 'RESOLVED': return 'Resolved';
    default: return humanizeKind(stage);
  }
}

function initials(name: string | null): string {
  if (!name) return 'SE';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

interface DayGroup {
  bucket: string;
  events: RenderedEvent[];
}

function groupByDay(events: RenderedEvent[]): DayGroup[] {
  const now = new Date();
  const groups = new Map<string, RenderedEvent[]>();
  for (const ev of events) {
    const bucket = dayBucketLabel(ev.at, now);
    const list = groups.get(bucket) ?? [];
    list.push(ev);
    groups.set(bucket, list);
  }
  return Array.from(groups, ([bucket, evts]) => ({ bucket, events: evts }));
}

/**
 * Vertical activity rail grouped by day with a sticky day header so busy
 * ladders stay scannable.
 */
export function TrackingTimeline({
  events,
  emptyLabel = 'No activity yet.',
}: {
  events: TrackingEventDto[];
  emptyLabel?: string;
}) {
  const grouped = useMemo(() => {
    const ordered = [...events].sort((a, b) => {
      const byTime = new Date(b.at).getTime() - new Date(a.at).getTime();
      return byTime || b.displayCode.localeCompare(a.displayCode);
    });
    return groupByDay(ordered.map(summarize));
  }, [events]);

  if (!events.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center shadow-soft dark:border-gray-700">
        <Clock size={20} className="mx-auto mb-2 text-gray-400" />
        <p className="text-sm font-medium tracking-tight text-gray-700 dark:text-gray-200">{emptyLabel}</p>
        <p className="mt-1 text-xs text-gray-500">
          Notifications, stage transitions and SLA events will appear here as the ladder progresses.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map((group) => (
        <section key={group.bucket} aria-label={group.bucket}>
          <div className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-2 bg-gradient-to-b from-white via-white/95 to-white/0 px-1 py-1 dark:from-gray-950 dark:via-gray-950/95 dark:to-gray-950/0">
            <span className="eyebrow">
              {group.bucket}
            </span>
            <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
            <span className="text-[11px] text-gray-400">
              {group.events.length} event{group.events.length === 1 ? '' : 's'}
            </span>
          </div>
          <ol className="relative space-y-3 pl-8">
            <span
              aria-hidden
              className="absolute left-[15px] top-2 h-[calc(100%-1rem)] w-px bg-gradient-to-b from-gray-200 via-gray-200 to-transparent dark:from-gray-800 dark:via-gray-800"
            />
            {group.events.map((event) => {
              const tone = TONE_CLASSES[event.tone];
              const channelLabel = event.channel ? CHANNEL_LABEL[event.channel] ?? event.channel : null;
              return (
                <li key={event.id} className="relative">
                  <span
                    aria-hidden
                    className={`absolute -left-[28px] top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full ring-4 ${tone.iconBg} ${tone.ring}`}
                  >
                    <event.Icon size={13} className={tone.icon} />
                  </span>
                  <article className="group rounded-xl border border-gray-100 bg-white px-3.5 py-2.5 shadow-soft transition-all ease-soft hover:border-gray-200 hover:shadow-soft-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700">
                    <header className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone.chip}`}>
                          {event.title}
                        </span>
                        {channelLabel ? (
                          <span className="rounded-md border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600 dark:border-gray-700 dark:text-gray-400">
                            via {channelLabel}
                          </span>
                        ) : null}
                      </div>
                      <time
                        className="cursor-help whitespace-nowrap text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        dateTime={event.at}
                        title={absoluteTime(event.at)}
                      >
                        {relativeTime(event.at)}
                      </time>
                    </header>
                    {event.subtitle ? (
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{event.subtitle}</div>
                    ) : null}
                    {event.note ? (
                      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-100">
                        {event.note}
                      </p>
                    ) : null}
                    <footer className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-2 text-[11px] text-gray-500 dark:border-gray-800">
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-red-600 text-[9px] font-bold text-white"
                        >
                          {initials(event.actorName)}
                        </span>
                        <span className="text-gray-700 dark:text-gray-200">
                          {event.actorName ?? 'System'}
                        </span>
                        {event.actorEmail ? (
                          <span className="hidden text-gray-400 sm:inline">· {event.actorEmail}</span>
                        ) : null}
                      </span>
                      <span aria-hidden className="text-gray-300 dark:text-gray-700">·</span>
                      <time
                        className="font-mono text-[10px] tabular-nums text-gray-400"
                        dateTime={event.at}
                      >
                        {absoluteTime(event.at)}
                      </time>
                      <span aria-hidden className="text-gray-300 dark:text-gray-700">·</span>
                      <span
                        className="font-mono text-[10px] text-gray-400"
                        title="Event reference code"
                      >
                        {event.displayCode}
                      </span>
                      {event.synthetic ? (
                        <>
                          <span aria-hidden className="text-gray-300 dark:text-gray-700">·</span>
                          <span
                            className="rounded border border-dashed border-gray-300 px-1 py-0.5 text-[10px] font-medium text-gray-400 dark:border-gray-700"
                            title="Inferred from entry counters — no audit log entry exists yet"
                          >
                            inferred
                          </span>
                        </>
                      ) : null}
                    </footer>
                  </article>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
