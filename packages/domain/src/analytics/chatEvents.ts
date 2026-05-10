import type { ChartSpec } from './chartSpec';

/** Streaming chat event over SSE. The frontend renders each variant differently. */
export type ChatEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; name: string; args: unknown; iteration: number }
  | { type: 'tool_result'; name: string; ok: boolean; preview?: unknown }
  | { type: 'partial_answer'; text: string }
  | {
      type: 'final';
      answer: string;
      chart_spec?: ChartSpec | null;
      alternatives?: ChartSpec[] | null;
      model?: string;
      latency_ms?: number;
      result_hash?: string;
      generated_sql?: string | null;
    }
  | { type: 'error'; code: string; message: string };

export type ChatEventType = ChatEvent['type'];
