"""SES Analytics Agent. Tool-calling loop; API ships scope-filtered rows so the agent never hits the DB."""
from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any, AsyncGenerator

import ollama

from tools.sql import DuckCache, canonicalize_rows, safe_query
from tools.charts import validate_chart_spec
from tools.stats import run_stat  # noqa: F401  (used once real agent wired)

# HIPAA: analytics runs on internal audit data, so the agent must use a LOCAL
# Ollama model only — no cloud LLM calls. DeepSeek-R1 is a reasoning model;
# the distill tag is run locally via Ollama. Its chain-of-thought is stripped
# before JSON parsing (see _strip_reasoning) and `format="json"` is disabled
# for R1 in _local_chat so the reasoning phase is not suppressed.
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
AGENT_MODEL = os.getenv("AI_AGENT_MODEL", "deepseek-r1:8b")

# Optional cloud provider for the analytics agent. OFF by default — the
# default posture stays local-only (Ollama). Enabled only when
# AI_ANALYTICS_PROVIDER=gemini AND GEMINI_API_KEY is set. The agent loop and
# its JSON-extraction path are provider-agnostic; only the single model call
# in _local_chat is swapped. Pseudonymization upstream (API side) is
# unaffected and still applied. NOTE: enabling this sends (pseudonymized)
# analytics rows to Google's hosted API — a deployment/compliance decision
# owned by the operator, not this code.
ANALYTICS_PROVIDER = os.getenv("AI_ANALYTICS_PROVIDER", "ollama").strip().lower()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("AI_GEMINI_MODEL", "gemini-2.0-flash").strip()
_USE_GEMINI = ANALYTICS_PROVIDER == "gemini" and bool(GEMINI_API_KEY)
_gemini_client = None  # lazy-initialised on first use
_IS_REASONING_AGENT = "deepseek-r1" in AGENT_MODEL.lower() or AGENT_MODEL.lower().startswith("r1")
# Reasoning models do their multi-step thinking *inside* one call, so they
# need fewer tool round-trips; each extra iteration is another slow R1 pass
# on CPU. Cap R1 at 2 by default (override via AI_AGENT_MAX_ITER), keep the
# established 3 for fast structured models.
AGENT_MAX_ITER = int(os.getenv("AI_AGENT_MAX_ITER", "2" if _IS_REASONING_AGENT else "3"))

_ollama_client = ollama.Client(host=OLLAMA_URL)

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


def _strip_reasoning(s: str) -> str:
    """Remove DeepSeek-R1 style chain-of-thought before the JSON answer.

    R1 emits a `<think> … </think>` block (sometimes unclosed if truncated)
    that can itself contain `{...}` while it reasons about the schema. Left
    in, the agent loop's "first {...} block" extractor would lock onto a
    brace inside the reasoning instead of the real tool/answer object. Strip
    the think span first; if the closing tag is missing, drop everything up
    to and including the last `</think>` we can find, else from the opening
    tag onward (the JSON, if any, follows the reasoning for R1).
    """
    import re

    s = re.sub(r"<think>.*?</think>", "", s, flags=re.DOTALL | re.IGNORECASE)
    # Truncated / unclosed think block: keep only what follows the last tag.
    low = s.lower()
    if "<think>" in low:
        close = low.rfind("</think>")
        if close != -1:
            s = s[close + len("</think>") :]
        else:
            s = s[: low.find("<think>")]
    return s.strip()


def _strip_codefence(s: str) -> str:
    s = _strip_reasoning(s)
    if s.startswith("```"):
        s = s.split("```", 2)[1]
        if s.startswith("json"):
            s = s[4:]
        s = s.rsplit("```", 1)[0]
    return s.strip()


def _extract_json_obj(cleaned: str, raw: str) -> dict[str, Any]:
    """Pull the first balanced {...} object out of model text → parsed dict.

    Shared by the Ollama and Gemini paths so JSON recovery behaves
    identically regardless of provider. Falls back to a plain `final`
    answer if nothing parses.
    """
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
        return {"final": raw[:600], "chart_spec": None}


def _gemini_call(messages: list[dict[str, str]]) -> str:
    """Single Gemini call → raw text (parsed by _extract_json_obj upstream).

    Opt-in cloud path. The package is imported lazily so the local-only
    default never requires google-genai to be installed. System messages
    become the system instruction; the rest are concatenated as the user
    turn (the agent loop already serialises tool results into messages).
    """
    global _gemini_client
    from google import genai  # lazy: only when AI_ANALYTICS_PROVIDER=gemini
    from google.genai import types

    if _gemini_client is None:
        _gemini_client = genai.Client(api_key=GEMINI_API_KEY)

    system_txt = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    convo = "\n\n".join(
        f"{m['role'].upper()}: {m['content']}"
        for m in messages
        if m["role"] != "system"
    )
    cfg = types.GenerateContentConfig(
        temperature=0.1,
        response_mime_type="application/json",
        **({"system_instruction": system_txt} if system_txt else {}),
    )
    resp = _gemini_client.models.generate_content(
        model=GEMINI_MODEL, contents=convo, config=cfg
    )
    return resp.text or "{}"


async def _local_chat(messages: list[dict[str, str]], model: str) -> dict[str, Any]:
    """Single LOCAL Ollama call returning parsed JSON content (HIPAA: no cloud).

    Ollama's chat API takes the system/user messages directly. For most models
    we request JSON mode so the agent-loop contract (a single {...} object) is
    honoured. DeepSeek-R1 is a reasoning model: forcing `format="json"`
    suppresses its <think> phase and sharply degrades answer quality, so for
    R1 we let it reason freely and recover the JSON afterwards via
    `_strip_reasoning` + the first-{...}-block extractor below.
    """
    import asyncio

    # Cloud provider branch (opt-in via env; see module config). Returns the
    # raw text; the shared _strip_codefence + first-{...} extractor below
    # parses it exactly like a local model's output, so the agent loop is
    # unchanged and this is fully reversible by unsetting the env flag.
    if _USE_GEMINI:
        content = await asyncio.to_thread(_gemini_call, messages)
        cleaned = _strip_codefence(content or "{}")
        return _extract_json_obj(cleaned, content)

    is_reasoning = "deepseek-r1" in model.lower() or model.lower().startswith("r1")

    def _call() -> str:
        options: dict[str, Any] = {"temperature": 0.1}
        if is_reasoning:
            # R1 emits a long <think> chain before the JSON answer. Give it
            # context headroom, but BOUND total output with num_predict so a
            # runaway reasoning loop can't blow the request budget on CPU
            # (the prior unbounded behaviour is what "model timed out").
            options["num_ctx"] = 16384
            options["num_predict"] = int(os.getenv("AI_AGENT_NUM_PREDICT", "2048"))
        else:
            options["num_ctx"] = 8192
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": [{"role": m["role"], "content": m["content"]} for m in messages],
            # keep_alive: keep the model resident between questions so users
            # don't pay the cold-load on every ask (local CPU inference).
            "keep_alive": "30m",
            "options": options,
        }
        if not is_reasoning:
            kwargs["format"] = "json"
        resp = _ollama_client.chat(**kwargs)
        return resp["message"]["content"]

    # ollama.Client is sync; keep the async agent loop responsive.
    content = await asyncio.to_thread(_call)
    cleaned = _strip_codefence(content or "{}")
    return _extract_json_obj(cleaned, content)


async def _real_agent_loop(
    question: str,
    rows: list[dict[str, Any]],
    process_code: str,
    dataset_version: str,
) -> AsyncGenerator[dict[str, Any], None]:
    """Local-Ollama JSON-mode agent loop. Yields ChatEvents."""
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
            result = await _local_chat(messages, AGENT_MODEL)
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
