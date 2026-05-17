import { FormEvent, useEffect, useRef, useState } from 'react';
import { Brain, Database, Loader2, Pin, Send, Sparkles } from 'lucide-react';
import type { ChartSpec, ChatEvent, FunctionId } from '@ses/domain';
import { streamAnalyticsChat } from '../../lib/api/analyticsApi';
import { usePinChart } from '../../lib/api/pinnedChartsHooks';
import { ChartRenderer } from './ChartRenderer';
import { ChartPicker } from './ChartPicker';
import { SuggestedChips } from './SuggestedChips';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  /** Final answer text. Empty while pending. */
  content: string;
  /** Short status line shown during streaming ("Thinking…", "Running SQL…"). */
  progress: string;
  events: ChatEvent[];
  chartSpec?: ChartSpec | null;
  alternatives?: ChartSpec[] | null;
  generatedSql?: string | null;
  pending?: boolean;
}

export function ChatPane({
  processCode,
  functionId,
  versionRef,
  compareTo,
}: {
  processCode: string;
  functionId?: FunctionId;
  versionRef?: string;
  compareTo?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [showSqlFor, setShowSqlFor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinChart = usePinChart(processCode);

  /** The user question that produced a given assistant message — used as the
   *  pinned chart's subtitle. Messages are appended user-then-assistant. */
  function questionFor(messageId: string): string | null {
    const idx = messages.findIndex((m) => m.id === messageId);
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === 'user') return messages[i]!.content;
    }
    return null;
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: q, progress: '', events: [] };
    const assistantMsg: Message = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      progress: 'Thinking…',
      events: [],
      pending: true,
    };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setInput('');
    setPending(true);
    try {
      const reqBody: import('../../lib/api/analyticsApi').ChatRequestBody = { question: q, useStub: false };
      if (functionId !== undefined) reqBody.functionId = functionId;
      if (versionRef !== undefined) reqBody.versionRef = versionRef;
      if (compareTo !== undefined) reqBody.compareTo = compareTo;
      let sawFinal = false;
      const ctrl = new AbortController();
      // Local-only (HIPAA) inference: a multi-iteration agent loop on a CPU
      // 7B model can run several minutes, especially on a cold model load.
      // Generous ceiling so a slow-but-valid answer isn't aborted as a "timeout".
      const hardTimeout = setTimeout(() => ctrl.abort(), 600_000);
      try {
        await streamAnalyticsChat(
          processCode,
          reqBody,
          (evt) => {
            setMessages((prev) => {
              const next = [...prev];
              const idx = next.findIndex((m) => m.id === assistantMsg.id);
              if (idx === -1) return prev;
              const m = { ...next[idx]!, events: [...next[idx]!.events, evt] };
              if (evt.type === 'thinking') {
                const t = evt.text.toLowerCase();
                if (t.startsWith('iteration')) {
                  // Show a generic progress label only — never surface the
                  // raw backend text, which includes the internal model
                  // name. This is a presentation concern; the data path is
                  // unchanged (local, real audit rows).
                  m.progress = 'Reasoning…';
                } else if (!m.progress || m.progress === 'Thinking…') {
                  m.progress = 'Loading data…';
                }
              } else if (evt.type === 'tool_call') {
                if (evt.name === 'sql_query') {
                  m.progress = 'Querying data…';
                } else {
                  m.progress = `Running ${evt.name}…`;
                }
              } else if (evt.type === 'tool_result') {
                m.progress = evt.ok ? 'Analysing results…' : 'Retrying…';
              } else if (evt.type === 'partial_answer') {
                m.content = m.content + evt.text;
                m.progress = '';
              } else if (evt.type === 'final') {
                sawFinal = true;
                m.content = evt.answer;
                m.progress = '';
                m.chartSpec = evt.chart_spec ?? null;
                m.alternatives = evt.alternatives ?? null;
                m.generatedSql = evt.generated_sql ?? null;
                m.pending = false;
              } else if (evt.type === 'error') {
                m.content = `Couldn't generate an answer: ${evt.message}`;
                m.progress = '';
                m.pending = false;
              }
              next[idx] = m;
              return next;
            });
          },
          ctrl.signal,
        );
      } finally {
        clearTimeout(hardTimeout);
      }
      if (!sawFinal) {
        setMessages((prev) =>
          prev.map((mm) =>
            mm.id === assistantMsg.id
              ? { ...mm, content: 'No answer returned (the model timed out). Try a simpler question.', progress: '', pending: false }
              : mm,
          ),
        );
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: `Error: ${(err as Error).message}`, progress: '', pending: false } : m,
        ),
      );
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center gap-2 border-b border-rule px-4 py-3 dark:border-gray-800">
        <Brain size={14} className="text-brand" />
        <div className="text-[13px] font-bold text-ink dark:text-white">
          Ask anything about this {functionId ? 'function' : 'process'}
        </div>
        <span className="flex-1" />
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setShowSqlFor(null);
            }}
            disabled={pending}
            className="rounded px-2 py-1 text-xs text-ink-3 transition-colors hover:bg-gray-100 hover:text-ink disabled:opacity-50 dark:hover:bg-gray-800"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="border-b border-rule px-3 py-2 dark:border-gray-800">
        <SuggestedChips
          {...(functionId !== undefined ? { functionId } : {})}
          onPick={(q) => void ask(q)}
        />
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto p-4"
        role="log"
        aria-label="Analytics conversation"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {messages.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <p className="max-w-[24ch] text-sm text-ink-3">
              Ask a question about this {functionId ? 'function' : 'process'}, or pick a
              suggestion above.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-rose-600 px-3 py-2 text-sm text-white'
                      : 'max-w-[90%] space-y-2 rounded-2xl rounded-bl-sm bg-gray-100 px-3 py-2 text-sm text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                  }
                >
                  {m.role === 'assistant' ? (
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500">
                      <Sparkles size={10} /> Analyst
                    </div>
                  ) : null}
                  {m.pending && !m.content ? (
                    <div
                      className="flex items-center gap-2 py-1 text-gray-600 dark:text-gray-300"
                      role="status"
                      aria-live="polite"
                    >
                      <Loader2
                        size={14}
                        className="animate-spin text-rose-600"
                        aria-hidden="true"
                      />
                      <span className="text-xs italic">{m.progress || 'Working…'}</span>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  )}
                  {m.chartSpec ? (
                    <div className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
                      <div className="flex items-center justify-between">
                        <ChartPicker
                          current={m.chartSpec}
                          {...(m.alternatives ? { alternatives: m.alternatives } : {})}
                          onSelect={(spec) =>
                            setMessages((prev) =>
                              prev.map((mm) => (mm.id === m.id ? { ...mm, chartSpec: spec } : mm)),
                            )
                          }
                        />
                        {m.generatedSql ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-rose-600"
                            onClick={() => setShowSqlFor(showSqlFor === m.id ? null : m.id)}
                          >
                            <Database size={11} /> {showSqlFor === m.id ? 'Hide SQL' : 'Show SQL'}
                          </button>
                        ) : null}
                      </div>
                      {showSqlFor === m.id && m.generatedSql ? (
                        <pre className="overflow-auto rounded bg-gray-50 p-2 text-[11px] dark:bg-gray-950">{m.generatedSql}</pre>
                      ) : null}
                      <ChartRenderer
                        spec={m.chartSpec}
                        onDatumClick={(datum) => {
                          const dd = m.chartSpec?.drilldown;
                          if (!dd) return;
                          let q = dd.questionTemplate;
                          for (const [k, v] of Object.entries(dd.bindings)) {
                            const val = (datum as Record<string, unknown>)[k] ?? (v === 'datum' ? JSON.stringify(datum) : '');
                            q = q.replaceAll(`{${k}}`, String(val));
                          }
                          void ask(q);
                        }}
                      />
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={pinChart.isPending}
                          onClick={() => {
                            if (!m.chartSpec) return;
                            const q = questionFor(m.id);
                            const label =
                              m.chartSpec.type === 'kpi' ? m.chartSpec.label : null;
                            pinChart.mutate({
                              title: q || label || 'Pinned chart',
                              question: q,
                              ...(functionId !== undefined ? { functionId } : {}),
                              chartSpec: m.chartSpec,
                            });
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-50"
                        >
                          <Pin size={11} /> Pin to dashboard
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
        <label htmlFor="analytics-chat-input" className="sr-only">
          Ask a question about this {functionId ? 'function' : 'process'}
        </label>
        <input
          id="analytics-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${functionId ?? 'this process'}…`}
          className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:border-gray-600 dark:bg-gray-800 dark:placeholder:text-gray-400"
          disabled={pending}
          aria-disabled={pending || undefined}
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="inline-flex min-h-[40px] items-center gap-1 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-offset-gray-900"
        >
          <Send size={14} aria-hidden="true" /> Ask
        </button>
      </form>
    </div>
  );
}
