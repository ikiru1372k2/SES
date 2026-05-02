import type { ProcessEscalationsPayload } from '@ses/domain';
import type { FunctionId } from '@ses/domain';
import { parseApiError } from './client';

export type { ProcessEscalationsPayload };

export async function fetchProcessEscalations(processIdOrCode: string): Promise<ProcessEscalationsPayload> {
  const res = await fetch(`/api/v1/processes/${encodeURIComponent(processIdOrCode)}/escalations`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to load escalations');
  return (await res.json()) as ProcessEscalationsPayload;
}

export interface TrackingEventDto {
  id: string;
  displayCode: string;
  channel: string;
  kind: string;
  note: string | null;
  reason: string | null;
  payload: unknown;
  triggeredById: string | null;
  /** Hydrated by the API so the Activity feed can render "by <name>" without N+1. */
  triggeredByName?: string | null;
  triggeredByEmail?: string | null;
  at: string;
  /** True for events synthesized from entry counters when no real DB event exists. */
  synthetic?: boolean;
}

export async function fetchTrackingEvents(trackingIdOrCode: string): Promise<TrackingEventDto[]> {
  const res = await fetch(`/api/v1/tracking/${encodeURIComponent(trackingIdOrCode)}/events`, {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to load tracking events');
  return (await res.json()) as TrackingEventDto[];
}

export function engineQueryParam(engine: FunctionId): string {
  return new URLSearchParams({ engine }).toString();
}
