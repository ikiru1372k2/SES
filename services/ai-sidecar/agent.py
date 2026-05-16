"""SES Analytics Agent. Tool-calling loop; API ships scope-filtered rows so the agent never hits the DB."""
from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any, AsyncGenerator

from tools.sql import DuckCache, canonicalize_rows, safe_query
from tools.charts import validate_chart_spec
from tools.stats import run_stat  # noqa: F401  (used once real agent wired)

AGENT_MODEL = os.getenv("AI_AGENT_MODEL", "claude-opus-4-7")
AGENT_MAX_ITER = int(os.getenv("AI_AGENT_MAX_ITER", "3"))

_duck_cache = DuckCache()


def _hash_rows(rows: list[dict[str, Any]]) -> str:
    return hashlib.sha256(canonicalize_rows(rows).encode("utf-8")).hexdigest()


def _stub_answer(question: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Hard-coded answers for the most common questions; used until the real agent is wired."""
    q = question.lower().strip()
    n = len(rows)
    if "worst shape" in q or "worst" in q:
        return {
            "answer": f"Of the {n} flagged rows in scope, the function with the most issues is shown below.",
            "chart_spec": _stub_chart_by_function(rows),
        }
    if "chronic" in q or "slow responder" in q:
        return {
            "answer": "Top managers by open issue count (proxy for slow response).",
            "chart_spec": _stub_chart_by_manager(rows),
        }
    if "predict" in q or "risky" in q:
        return {
            "answer": "Risky rows surfaced by IsolationForest are not yet wired in stub mode — listing top 5 by severity instead.",
            "chart_spec": _stub_chart_severity(rows),
        }
    if "missing" in q:
        return {
            "answer": "Missing-value summary across canonical columns.",
            "chart_spec": _stub_chart_missing(rows),
        }
    if "compare" in q or "vs" in q or "versus" in q:
        return {
            "answer": "Cross-version comparison requires the compareTo scope; once set, charts will show two series.",
            "chart_spec": None,
        }
    return {
        "answer": (
            f"(Stub mode — qwen2.5-coder not yet wired.) "
            f"There are {n} flagged rows in the current scope."
        ),
        "chart_spec": _stub_chart_by_severity(rows) if rows else None,
    }


def _stub_chart_by_function(rows: list[dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for r in rows:
        k = str(r.get("engineId") or r.get("functionId") or r.get("ruleCode") or "unknown")
        counts[k] = counts.get(k, 0) + 1
    data = [{"function": k, "count": v} for k, v in sorted(counts.items(), key=lambda kv: -kv[1])]
    return {
        "type": "bar",
        "data": data,
        "x": "function",
        "y": "count",
        "source": {"executed_at": _now_iso(), "row_count": len(data), "dataset_version": "stub"},
    }


def _stub_chart_by_manager(rows: list[dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for r in rows:
        k = str(r.get("projectManager") or "Unassigned")
        counts[k] = counts.get(k, 0) + 1
    data = [{"manager": k, "count": v} for k, v in sorted(counts.items(), key=lambda kv: -kv[1])][:10]
    return {
        "type": "bar",
        "data": data,
        "x": "manager",
        "y": "count",
        "source": {"executed_at": _now_iso(), "row_count": len(data), "dataset_version": "stub"},
    }


def _stub_chart_by_severity(rows: list[dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = {"High": 0, "Medium": 0, "Low": 0}
    for r in rows:
        s = str(r.get("severity") or "Low")
        counts[s] = counts.get(s, 0) + 1
    data = [{"name": k, "value": v} for k, v in counts.items() if v > 0]
    return {
        "type": "pie",
        "data": data,
        "name": "name",
        "value": "value",
        "source": {"executed_at": _now_iso(), "row_count": len(data), "dataset_version": "stub"},
    }


def _stub_chart_severity(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return _stub_chart_by_severity(rows)


def _stub_chart_missing(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {
            "type": "table",
            "columns": ["column", "missing"],
            "rows": [],
            "source": {"executed_at": _now_iso(), "row_count": 0, "dataset_version": "stub"},
        }
    sample_keys = list(rows[0].keys())
    out: list[dict[str, Any]] = []
    n = len(rows)
    for k in sample_keys:
        missing = sum(1 for r in rows if r.get(k) in (None, "", 0))
        if missing:
            out.append({"column": k, "missing": missing, "pct": round(missing * 100.0 / n, 1)})
    return {
        "type": "table",
        "columns": ["column", "missing", "pct"],
        "rows": out,
        "source": {"executed_at": _now_iso(), "row_count": len(out), "dataset_version": "stub"},
    }


def _now_iso() -> str:
    import datetime as _dt

    return _dt.datetime.utcnow().isoformat() + "Z"


_SYSTEM_PROMPT = """You are an SES audit data analyst. The user asks questions about an in-memory DuckDB view named `issues`.

Columns on `issues` (all may be null):
  issueKey, ruleCode, projectNo, projectName, projectManager, email,
  severity ('High'|'Medium'|'Low'), reason, effort, rowIndex, sheetName,
  projectState, engineId, runCode

Reply with EXACTLY ONE JSON object. No prose, no markdown, no code fences.

Each turn, choose ONE shape:

SHAPE A — run a SELECT:
{"tool":"sql_query","sql":"SELECT ..."}

SHAPE B — final answer (use after you have rows OR you're sure no SQL is needed):
{"final":"<short answer>","chart_spec":<spec or null>,"generated_sql":"<your last SELECT or empty>"}

chart_spec MUST be EXACTLY this shape (this is OUR schema, not Chart.js):

  bar:    {"type":"bar","data":[{...row...}],"x":"<col>","y":"<col or [cols]>","source":{"executed_at":"2026-01-01T00:00:00Z","row_count":N,"dataset_version":"v"}}
  line:   {"type":"line","data":[{...}],"x":"<col>","y":"<col>","source":{...}}
  pie:    {"type":"pie","data":[{...}],"name":"<col>","value":"<col>","source":{...}}
  table:  {"type":"table","columns":["c1","c2"],"rows":[{...}],"source":{...}}

`data` MUST be a JSON array of objects (one per row from your SELECT). Do NOT wrap it in {labels,datasets} or anything else.
If the SQL result is empty, set chart_spec to null.

Examples (correct):

User asked "top 3 managers", you ran SELECT projectManager, COUNT(*) c FROM issues GROUP BY projectManager ORDER BY c DESC LIMIT 3, got [{"projectManager":"Alice","c":2},{"projectManager":"Bob","c":1}]. Final:
{"final":"Alice (2) and Bob (1) lead.","chart_spec":{"type":"bar","data":[{"projectManager":"Alice","c":2},{"projectManager":"Bob","c":1}],"x":"projectManager","y":"c","source":{"executed_at":"2026-01-01T00:00:00Z","row_count":2,"dataset_version":"v"}},"generated_sql":"SELECT projectManager, COUNT(*) c FROM issues GROUP BY projectManager ORDER BY c DESC LIMIT 3"}

For "list missing PSU projects" → use type="table".
For severity breakdown → type="pie" with name="severity",value="cnt".
"""


def _strip_codefence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = s.split("```", 2)[1]
        if s.startswith("json"):
            s = s[4:]
        s = s.rsplit("```", 1)[0]
    return s.strip()


async def _claude_chat(messages: list[dict[str, str]], model: str) -> dict[str, Any]:
    """Single Anthropic Claude API call returning parsed JSON content."""
    import anthropic

    system_prompt = ""
    conv_messages = []
    for msg in messages:
        if msg["role"] == "system":
            system_prompt = msg["content"]
        else:
            conv_messages.append({"role": msg["role"], "content": msg["content"]})

    client = anthropic.AsyncAnthropic()

    response = await client.messages.create(
        model=model,
        max_tokens=1024,
        # Cache the stable system prompt to reduce cost on multi-turn retries
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=conv_messages,
    )

    content = response.content[0].text if response.content else "{}"
    cleaned = _strip_codefence(content)
    # Extract first {...} block in case the model added prose.
    depth = 0
    start = -1
    for i, ch in enumerate(cleaned):
        if ch == "{":
            if start == -1:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                cleaned = cleaned[start : i + 1]
                break
    try:
        return json.loads(cleaned)
    except Exception:
        return {"final": content[:600], "chart_spec": None}


async def _real_agent_loop(
    question: str,
    rows: list[dict[str, Any]],
    process_code: str,
    dataset_version: str,
) -> AsyncGenerator[dict[str, Any], None]:
    """Claude JSON-mode agent loop. Yields ChatEvents."""
    if not rows:
        yield {
            "type": "final",
            "answer": "No rows in scope — run an audit first.",
            "chart_spec": None,
            "alternatives": None,
            "model": AGENT_MODEL,
            "result_hash": _hash_rows(rows),
            "generated_sql": None,
        }
        return

    schema_sample = rows[0]
    columns = list(schema_sample.keys())

    def _distinct(col: str, limit: int = 25) -> list[Any]:
        seen: list[Any] = []
        s: set[str] = set()
        for r in rows:
            v = r.get(col)
            if v is None:
                continue
            k = str(v)
            if k in s:
                continue
            s.add(k)
            seen.append(v)
            if len(seen) >= limit:
                break
        return seen

    # Distinct-values dictionary across low-cardinality columns so the model can
    # map natural-language to actual values without per-function hardcoding.
    LOW_CARD_LIMIT = 30  # omit columns with more distinct values than this
    distinct_dict: dict[str, list[Any]] = {}
    for col in columns:
        vals = _distinct(col, LOW_CARD_LIMIT + 1)
        if 0 < len(vals) <= LOW_CARD_LIMIT:
            distinct_dict[col] = vals

    sample_rows = rows[:3]

    user_msg = (
        f"Question: {question}\n\n"
        f"DATA DICTIONARY for the `issues` view in this scope:\n"
        f"- columns: {', '.join(columns)}\n"
        f"- total rows: {len(rows)}\n"
        f"- distinct values per low-cardinality column (use EXACT strings in WHERE clauses):\n"
        f"{json.dumps(distinct_dict, default=str, indent=2)[:3500]}\n\n"
        f"- 3 sample rows: {json.dumps(sample_rows, default=str)[:1500]}\n"
        f"- dataset_version: {dataset_version}\n\n"
        f"How to map the user's words to columns and values:\n"
        f"- The user's question describes audit findings. Look at the distinct\n"
        f"  ruleCode list above and match keywords from the question to the\n"
        f"  actual ruleCode strings (e.g. if user says 'missing X', look for\n"
        f"  any ruleCode containing 'X' or 'MISSING_X').\n"
        f"- Use ruleCode LIKE '%KEYWORD%' for fuzzy matches across rule families.\n"
        f"- 'unmapped' / 'missing manager' → projectManager IS NULL OR projectManager = '' OR projectManager = 'Unassigned'.\n"
        f"- 'missing email' → email IS NULL OR email = ''.\n"
        f"- For 'top N <thing>', GROUP BY <thing-column> and ORDER BY COUNT(*) DESC.\n"
        f"- ALWAYS use ruleCode / engineId / severity values copied verbatim\n"
        f"  from the distinct lists above. Never invent rule codes.\n"
        f"- If no matching ruleCode exists for the user's keyword, search the\n"
        f"  reason and projectName columns with ILIKE '%keyword%' instead.\n"
    )
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    last_sql: str | None = None
    for iteration in range(1, AGENT_MAX_ITER + 1):
        yield {"type": "thinking", "text": f"iteration {iteration} (model={AGENT_MODEL})"}
        try:
            result = await _claude_chat(messages, AGENT_MODEL)
        except Exception as e:
            yield {"type": "error", "code": "LLM_FAIL", "message": str(e)}
            return

        if isinstance(result.get("final"), str):
            spec = result.get("chart_spec")
            if spec:
                try:
                    validate_chart_spec(spec)
                except Exception as ve:
                    if iteration < AGENT_MAX_ITER:
                        # Feed validation error back so the model can fix the chart_spec.
                        messages.append(
                            {"role": "assistant", "content": json.dumps(result)}
                        )
                        messages.append(
                            {"role": "user", "content": f"chart_spec_error: {ve}. Fix chart_spec and reply again with corrected SHAPE B."}
                        )
                        continue
                    spec = None
            yield {
                "type": "final",
                "answer": result["final"],
                "chart_spec": spec,
                "alternatives": result.get("alternatives"),
                "model": AGENT_MODEL,
                "result_hash": _hash_rows(rows),
                "generated_sql": result.get("generated_sql") or last_sql,
            }
            return

        if result.get("tool") == "sql_query" and isinstance(result.get("sql"), str):
            sql = result["sql"]
            last_sql = sql
            yield {"type": "tool_call", "name": "sql_query", "args": {"sql": sql}, "iteration": iteration}
            con = _duck_cache.get(process_code, dataset_version)
            if con is None:
                yield {"type": "error", "code": "NO_DATASET", "message": "dataset not materialised"}
                return
            try:
                qrows = safe_query(con, sql)
            except Exception as e:
                yield {"type": "tool_result", "name": "sql_query", "ok": False, "preview": {"error": str(e)}}
                messages.append(
                    {"role": "assistant", "content": json.dumps({"tool": "sql_query", "sql": sql})}
                )
                messages.append({"role": "user", "content": f"sql_error: {e}. Fix and try again."})
                continue
            preview = qrows[:5]
            yield {"type": "tool_result", "name": "sql_query", "ok": True, "preview": {"rows": preview, "row_count": len(qrows)}}
            messages.append(
                {"role": "assistant", "content": json.dumps({"tool": "sql_query", "sql": sql})}
            )
            messages.append(
                {"role": "user", "content": json.dumps({"sql_result_rows": qrows[:200], "row_count": len(qrows)})}
            )
            continue

        yield {
            "type": "final",
            "answer": json.dumps(result)[:600],
            "chart_spec": None,
            "alternatives": None,
            "model": AGENT_MODEL,
            "result_hash": _hash_rows(rows),
            "generated_sql": last_sql,
        }
        return

    yield {
        "type": "final",
        "answer": "Iteration limit reached without a final answer.",
        "chart_spec": None,
        "alternatives": None,
        "model": AGENT_MODEL,
        "result_hash": _hash_rows(rows),
        "generated_sql": last_sql,
    }


async def stream_chat(
    question: str,
    process_code: str,
    function_id: str | None,
    version_ref: str | None,
    rows: list[dict[str, Any]],
    use_stub: bool = True,
) -> AsyncGenerator[dict[str, Any], None]:
    """Yield ChatEvent dicts. Stub mode for first run; real agent once Ollama is wired."""
    import json as _json  # noqa: F401
    started = time.monotonic()
    dataset_version = version_ref or _hash_rows(rows)[:8]
    _duck_cache.materialize(process_code, dataset_version, rows)

    yield {"type": "thinking", "text": f"scope={process_code}/{function_id or 'process'} version={dataset_version} rows={len(rows)}"}

    if use_stub:
        yield {"type": "tool_call", "name": "stub.match", "args": {"question": question}, "iteration": 1}
        result = _stub_answer(question, rows)
        yield {"type": "tool_result", "name": "stub.match", "ok": True, "preview": {"matched": True}}
        yield {
            "type": "final",
            "answer": result["answer"],
            "chart_spec": result["chart_spec"],
            "alternatives": None,
            "model": "stub",
            "latency_ms": int((time.monotonic() - started) * 1000),
            "result_hash": _hash_rows(rows),
            "generated_sql": None,
        }
        return

    async for evt in _real_agent_loop(question, rows, process_code, dataset_version):
        if evt.get("type") == "final":
            evt["latency_ms"] = int((time.monotonic() - started) * 1000)
        yield evt


def query_sql(process_code: str, dataset_version: str, sql: str) -> list[dict[str, Any]]:
    con = _duck_cache.get(process_code, dataset_version)
    if con is None:
        raise ValueError("dataset not materialized for this scope; send rows first")
    return safe_query(con, sql)
