"""SES Analytics Agent.

Tool-calling loop over qwen2.5-coder. The API ships rows for the active
scope with each request — the agent never reaches into the database.

Day-1 stub: 5 canned answers keyed by phrase match. Replaced by a real
JSON-mode agent loop once Ollama + qwen2.5-coder are pulled.
"""
from __future__ import annotations

import hashlib
import os
import time
from typing import Any, AsyncGenerator

from .tools.sql import DuckCache, canonicalize_rows, safe_query
from .tools.charts import validate_chart_spec
from .tools.stats import run_stat

AGENT_MODEL = os.getenv("AI_AGENT_MODEL", "qwen2.5-coder:7b-instruct")
AGENT_MAX_ITER = int(os.getenv("AI_AGENT_MAX_ITER", "5"))

_duck_cache = DuckCache()


def _hash_rows(rows: list[dict[str, Any]]) -> str:
    return hashlib.sha256(canonicalize_rows(rows).encode("utf-8")).hexdigest()


def _stub_answer(question: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Hard-coded answers for the 5 most common questions — used until
    Ollama is online and qwen2.5-coder is pulled. Always honest about scope.
    """
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


async def stream_chat(
    question: str,
    process_code: str,
    function_id: str | None,
    version_ref: str | None,
    rows: list[dict[str, Any]],
    use_stub: bool = True,
) -> AsyncGenerator[dict[str, Any], None]:
    """Yield ChatEvent dicts. Stub-only for day 1."""
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

    # Real agent loop placeholder — wired once qwen2.5-coder is pulled.
    yield {"type": "error", "code": "AGENT_NOT_WIRED", "message": "Real agent path not yet enabled — set AI_AGENT_USE_STUB=1"}


def query_sql(process_code: str, dataset_version: str, sql: str) -> list[dict[str, Any]]:
    con = _duck_cache.get(process_code, dataset_version)
    if con is None:
        raise ValueError("dataset not materialized for this scope; send rows first")
    return safe_query(con, sql)
