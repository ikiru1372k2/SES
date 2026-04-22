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
} from 'lucide-react';
import { useMemo } from 'react';
import type { TrackingEventDto } from '../../lib/api/escalationsApi';

type Tone = 'gray' | 'blue' | 'amber' | 'emerald' | 'red' | 'violet';

interface RenderedEvent {
  id: string;
  at: string;
  title: string;
  subtitle: string | null;
  note: string | null;
  tone: Tone;
  Icon: LucideIcon;
}

// One source of truth for how we render each event kind. Adding a new
// event type is one entry here — the UI picks up the icon + label + tone
// automatically. Keeps the timeline visually coherent as new event kinds
// land in the state machine.
const EVENT_STYLE: Record<string, { label: string; tone: Tone; Icon: LucideIcon }> = {
  escalation_sent: { label: 'Escalation sent', tone: 'blue', Icon: Send },
  contact:         { label: 'Contact logged', tone: 'gray', Icon: MessageSquare },
  stage_transition:{ label: 'Stage changed', tone: 'violet', Icon: RefreshCcw },
  sla_snoozed:     { label: 'SLA snoozed', tone: 'amber', Icon: PauseCircle },
  sla_draft_queued:{ label: 'SLA breach — follow-up queued', tone: 'amber', Icon: AlertTriangle },
  bulk_snooze:     { label: 'Bulk snooze', tone: 'amber', Icon: PauseCircle },
  bulk_acknowledge:{ label: 'Acknowledged', tone: 'emerald', Icon: CheckCircle2 },
  bulk_reescalate: { label: 'Re-escalated', tone: 'red', Icon: ArrowUpCircle },
  manager_response:{ label: 'Manager responded', tone: 'emerald', Icon: Users },
  escalation_reminder: { label: 'Reminder sent', tone: 'blue', Icon: Mail },
};

const TONE_CLASSES: Record<Tone, { ring: string; dot: string; icon: string; chip: string }> = {
  gray:    { ring: 'ring-gray-200 dark:ring-gray-700',   dot: 'bg-gray-400',    icon: 'text-gray-500',    chip: 'bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-200' },
  blue:    { ring: 'ring-blue-200 dark:ring-blue-900',   dot: 'bg-blue-500',    icon: 'text-blue-600',    chip: 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200' },
  amber:   { ring: 'ring-amber-200 dark:ring-amber-900', dot: 'bg-amber-500',   icon: 'text-amber-600',   chip: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200' },
  emerald: { ring: 'ring-emerald-200 dark:ring-emerald-900', dot: 'bg-emerald-500', icon: 'text-emerald-600', chip: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' },
  red:     { ring: 'ring-red-200 dark:ring-red-900',     dot: 'bg-red-500',     icon: 'text-red-600',     chip: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' },
  violet:  { ring: 'ring-violet-200 dark:ring-violet-900', dot: 'bg-violet-500', icon: 'text-violet-600', chip: 'bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200' },
};

function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const delta = t - now;
  const abs = Math.abs(delta);
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

function summarize(event: TrackingEventDto): RenderedEvent {
  const reasonKey = event.reason && EVENT_STYLE[event.reason] ? event.reason : null;
  const kindKey = EVENT_STYLE[event.kind] ? event.kind : null;
  const styleKey = reasonKey ?? kindKey;
  const style = styleKey ? EVENT_STYLE[styleKey]! : { label: event.kind, tone: 'gray' as Tone, Icon: Clock };

  // Derive a stage-transition subtitle from the payload if available.
  let subtitle: string | null = null;
  if (event.kind === 'stage_transition' && event.payload && typeof event.payload === 'object') {
    const payload = event.payload as { previousStage?: string; nextStage?: string };
    if (payload.previousStage && payload.nextStage) {
      subtitle = `${payload.previousStage} → ${payload.nextStage}`;
    }
  } else if (event.channel && event.channel !== 'manual' && event.channel !== 'stage_transition') {
    subtitle = `via ${event.channel}`;
  }

  return {
    id: event.id,
    at: event.at,
    title: style.label,
    subtitle,
    note: event.note?.trim() || null,
    tone: style.tone,
    Icon: style.Icon,
  };
}

/**
 * Vertical activity rail similar to Linear/Jira — a dotted connector with
 * per-event pills. Pure presentation; given events, it renders them.
 */
export function TrackingTimeline({
  events,
  emptyLabel = 'No activity yet.',
}: {
  events: TrackingEventDto[];
  emptyLabel?: string;
}) {
  const rendered = useMemo(() => events.map(summarize), [events]);
  // `relativeTime` already defaults `now` to `Date.now()` internally; we
  // pass nothing here so the timeline re-evaluates per render without
  // calling an impure function in the render body itself.

  if (!events.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-sm text-gray-500 dark:border-gray-800">
        {emptyLabel}
      </div>
    );
  }

  return (
    <ol className="relative space-y-3 pl-6">
      <span aria-hidden className="absolute left-[11px] top-2 h-[calc(100%-1rem)] w-px bg-gray-200 dark:bg-gray-800" />
      {rendered.map((event) => {
        const classes = TONE_CLASSES[event.tone];
        return (
          <li key={event.id} className="relative">
            <span
              aria-hidden
              className={`absolute -left-[20px] top-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white ring-4 dark:bg-gray-950 ${classes.ring}`}
            >
              <event.Icon size={12} className={classes.icon} />
            </span>
            <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${classes.chip}`}>
                  {event.title}
                </span>
                <span
                  className="text-[11px] text-gray-500"
                  title={new Date(event.at).toLocaleString()}
                >
                  {relativeTime(event.at)}
                </span>
              </div>
              {event.subtitle ? (
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{event.subtitle}</div>
              ) : null}
              {event.note ? (
                <div className="mt-1 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-100">
                  {event.note}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
