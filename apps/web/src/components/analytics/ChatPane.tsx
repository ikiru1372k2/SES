import { FormEvent, useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Database } from 'lucide-react';
import type { ChartSpec, ChatEvent, FunctionId } from '@ses/domain';
import { streamAnalyticsChat } from '../../lib/api/analyticsApi';
import { ChartRenderer } from './ChartRenderer';
import { ChartPicker } from './ChartPicker';
import { SuggestedChips } from './SuggestedChips';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: q, events: [] };
    const assistantMsg: Message = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      events: [],
      pending: true,
    };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setInput('');
    setPending(true);
    try {
      const reqBody: import('../../lib/api/analyticsApi').ChatRequestBody = { question: q, useStub: true };
      if (functionId !== undefined) reqBody.functionId = functionId;
      if (versionRef !== undefined) reqBody.versionRef = versionRef;
      if (compareTo !== undefined) reqBody.compareTo = compareTo;
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
              m.content = m.content || `…${evt.text}`;
            } else if (evt.type === 'partial_answer') {
              m.content = (m.content === `…${evt.text}` ? '' : m.content) + evt.text;
            } else if (evt.type === 'final') {
              m.content = evt.answer;
              m.chartSpec = evt.chart_spec ?? null;
              m.alternatives = evt.alternatives ?? null;
              m.generatedSql = evt.generated_sql ?? null;
              m.pending = false;
            } else if (evt.type === 'error') {
              m.content = `Error: ${evt.message}`;
              m.pending = false;
            }
            next[idx] = m;
            return next;
          });
        },
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: `Error: ${(err as Error).message}`, pending: false } : m,
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
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Ask a question about this {functionId ? 'function' : 'process'}. Try one:
            </p>
            <SuggestedChips {...(functionId !== undefined ? { functionId } : {})} onPick={(q) => void ask(q)} />
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
                  <div className="whitespace-pre-wrap">{m.content || (m.pending ? '…' : '')}</div>
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
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${functionId ?? 'this process'}…`}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          <Send size={14} /> Ask
        </button>
      </form>
    </div>
  );
}
