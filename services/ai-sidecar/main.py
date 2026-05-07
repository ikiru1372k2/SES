"""
SES AI Service — v1
====================
FastAPI app that wraps Docling + Qwen2.5:7b for SES.

Endpoints:
  GET  /health                  Liveness check
  POST /pilot/upload            Upload Excel to sandbox, get session_id + columns
  POST /pilot/generate          Generate rule JSON from English description
  POST /pilot/preview           Apply generated rule to sandbox Excel, return flagged rows
  POST /pilot/cleanup           Delete sandbox file when admin done
  POST /chat/ask                Ask a question about an uploaded Excel (no RAG yet)

Runs at: http://localhost:8000
SES (NestJS) calls these endpoints over HTTP.
"""

import os
import uuid
import json
from pathlib import Path

import ollama
import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from docling.document_converter import DocumentConverter

# ── CONFIG ─────────────────────────────────────────────────────────
SANDBOX_DIR = Path(os.getenv("SANDBOX_DIR", "/tmp/ses-ai-sandbox"))
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
MODEL = os.getenv("AI_MODEL", "qwen2.5:7b")
# Smaller, snappier instruction-follower for the prompt enhancer.
# Falls back to MODEL if the env var is unset.
ENHANCE_MODEL = os.getenv("AI_ENHANCE_MODEL", "llama3:latest")
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "20"))

SANDBOX_DIR.mkdir(parents=True, exist_ok=True)

# ── INIT ───────────────────────────────────────────────────────────
app = FastAPI(title="SES AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

converter = DocumentConverter()
ollama_client = ollama.Client(host=OLLAMA_URL)


# ── HELPERS ────────────────────────────────────────────────────────
def _find_session_file(session_id: str) -> Path:
    matches = list(SANDBOX_DIR.glob(f"{session_id}.*"))
    if not matches:
        raise HTTPException(404, f"Session {session_id} not found or expired")
    return matches[0]


def _parse_excel(file_path: Path) -> dict:
    result = converter.convert(str(file_path))
    doc = result.document
    markdown = doc.export_to_markdown()

    columns = []
    tables_meta = []
    for table in doc.tables:
        df = table.export_to_dataframe()
        cols = list(df.columns)
        columns.extend(cols)
        tables_meta.append({
            "columns": cols,
            "row_count": len(df),
            "sample_rows": df.head(3).to_dict("records"),
        })

    return {
        "markdown": markdown,
        "all_columns": list(dict.fromkeys(columns)),
        "tables": tables_meta,
    }


def _ask_qwen(prompt: str, temperature: float = 0.1) -> str:
    resp = ollama_client.chat(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        options={"temperature": temperature},
    )
    return resp["message"]["content"]


def _ask_enhancer(prompt: str, temperature: float = 0.2) -> str:
    """Same as _ask_qwen but uses ENHANCE_MODEL (default llama3:latest).
    The enhancer is a short rewrite task — different model, different prompt
    style than the JSON-generation task that qwen2.5:7b owns."""
    resp = ollama_client.chat(
        model=ENHANCE_MODEL,
        messages=[{"role": "user", "content": prompt}],
        options={"temperature": temperature},
    )
    return resp["message"]["content"]


def _strip_json_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.rsplit("```", 1)[0]
    return text.strip()


# ── REQUEST MODELS ─────────────────────────────────────────────────
class GenerateRuleReq(BaseModel):
    # session_id is now optional — SES passes columns directly to avoid
    # double-tracking sessions on both sides. Standalone smoke test still
    # uses the session-lookup path.
    session_id: str | None = None
    engine: str
    description: str
    columns: list[str] | None = None


class PreviewReq(BaseModel):
    session_id: str
    rule: dict


class CleanupReq(BaseModel):
    session_id: str


class AskReq(BaseModel):
    session_id: str
    question: str


# ── ENDPOINTS ──────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": MODEL,
        "ollama_url": OLLAMA_URL,
        "sandbox_dir": str(SANDBOX_DIR),
    }


@app.post("/pilot/upload")
async def pilot_upload(file: UploadFile = File(...)):
    contents = await file.read()
    size_mb = len(contents) / (1024 * 1024)
    if size_mb > MAX_UPLOAD_MB:
        raise HTTPException(413, f"File too large: {size_mb:.1f}MB (max {MAX_UPLOAD_MB}MB)")

    session_id = str(uuid.uuid4())
    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "xlsx"
    file_path = SANDBOX_DIR / f"{session_id}.{ext}"
    file_path.write_bytes(contents)

    try:
        parsed = _parse_excel(file_path)
    except Exception as e:
        file_path.unlink(missing_ok=True)
        raise HTTPException(400, f"Could not parse Excel: {e}")

    return {
        "session_id": session_id,
        "file_name": file.filename,
        "size_mb": round(size_mb, 2),
        "columns": parsed["all_columns"],
        "tables": parsed["tables"],
        "preview_markdown": parsed["markdown"][:1000],
    }


@app.post("/pilot/generate")
async def pilot_generate(req: GenerateRuleReq):
    """
    Returns SES-compatible rule spec JSON. SES expects either
    { "spec": { ...AiRuleSpec... } } or the spec at top-level.

    Two paths:
      - SES path: caller passes `columns` directly; no FastAPI session needed.
      - Smoke-test path: caller passes `session_id`; we re-parse from disk.
    """
    columns: list[str] = []
    sample_markdown = ""

    if req.columns:
        columns = req.columns
    elif req.session_id:
        file_path = _find_session_file(req.session_id)
        parsed = _parse_excel(file_path)
        columns = parsed["all_columns"]
        sample_markdown = parsed["markdown"][:2500]
    else:
        raise HTTPException(400, "Either `columns` or `session_id` is required")

    available_cols = ", ".join(columns)
    sample_block = f"Sample of the workbook:\n{sample_markdown}\n\n" if sample_markdown else ""
    prompt = f"""You are an audit rule generator for the SES "{req.engine}" engine.

Excel column list: {available_cols}

{sample_block}Admin description:
"{req.description}"

Return ONLY valid JSON, no markdown fences, no explanation. Use this exact shape:
{{
  "spec": {{
    "ruleCode": "ai_placeholder",
    "ruleVersion": 1,
    "functionId": "{req.engine}",
    "name": "<short descriptive rule name>",
    "category": "<one of: Overplanning, Missing Planning, Function Rate, Internal Cost Rate, Other, Effort Threshold, Missing Data, Planning Risk, Capacity Risk, Data Quality, Needs Review>",
    "severity": "<one of: High, Medium, Low>",
    "flagMessage": "<short message shown when rule fires; you may use {{projectNo}}, {{projectName}} placeholders>",
    "logic": <rule node tree using only the operators below>
  }}
}}

Operator vocabulary (whitelisted):
  Comparison: ">", "<", ">=", "<=", "==", "!="
  Percentage: "%>"  (cell exceeds compareTo column by N percent — use "compareTo" field)
  String:     "contains", "startsWith", "endsWith"
  Presence:   "isBlank", "isMissing", "isNotMissing"
  Set:        "isOneOf"  (use "values": [...])
  Compose:    "and", "or"  (use "children": [...], max nesting depth 2)

Each leaf node MUST have a "column" field that exactly matches one of the available columns.
Return ONLY the JSON object. No prose.
"""

    raw = _ask_qwen(prompt, temperature=0.1)
    cleaned = _strip_json_fences(raw)
    try:
        parsed_json = json.loads(cleaned)
        return parsed_json
    except json.JSONDecodeError as e:
        return {"success": False, "error": str(e), "raw": raw}


class EnhancePromptReq(BaseModel):
    session_id: str | None = None
    engine: str
    prompt: str
    columns: list[str] | None = None


@app.post("/pilot/enhance")
async def pilot_enhance(req: EnhancePromptReq):
    """
    Take an admin's rough idea and rewrite it as a tight, structured
    prompt that names exact columns, picks an operator, and is unambiguous.
    Returns plain text (not JSON).
    """
    columns: list[str] = req.columns or []
    if not columns and req.session_id:
        try:
            columns = _parse_excel(_find_session_file(req.session_id))["all_columns"]
        except HTTPException:
            columns = []
    if not columns:
        raise HTTPException(400, "Either `columns` or `session_id` is required")

    available = "\n".join(f"  - {c}" for c in columns)
    # Tight template: one-shot example, forbid severity in output, force
    # the model to literally pick from the column list (with a "best match"
    # instruction so a near-miss like "PSU" → "PSU Relevant" still works).
    p = f"""Rewrite the user's audit-rule idea as ONE clear sentence.

RULES:
- Reference EXACTLY ONE column name, copied verbatim from this list:
{available}
- If the user's term doesn't match a column exactly, pick the closest one from the list.
- Use one of these phrases for the check: "is blank", "is missing", "is not missing", "contains X", "starts with X", "ends with X", "equals X", "is one of A or B", "is greater than N", "is less than N", "exceeds N percent of <other column>".
- Do NOT mention severity, priority, or category.
- Do NOT add quotes around the whole sentence.
- Output the sentence ONLY. No preamble. No explanation. No markdown.

EXAMPLE
Columns: Project Manager, State, Effort
User: flag bad pm
Output: Flag rows where Project Manager is blank.

EXAMPLE
Columns: Contractor Type, Status
User: flag main-contractor entries
Output: Flag rows where Contractor Type contains "Main-Contractor".

NOW DO THIS ONE
User: {req.prompt}
Output:"""

    enhanced = _ask_enhancer(p, temperature=0.2).strip()
    # Strip surrounding quotes / common preambles if the model ignored instructions.
    for prefix in ("Output:", "output:", "Rewritten:", "Rewrite:"):
        if enhanced.lower().startswith(prefix.lower()):
            enhanced = enhanced[len(prefix):].strip()
    if (enhanced.startswith('"') and enhanced.endswith('"')) or (
        enhanced.startswith("'") and enhanced.endswith("'")
    ):
        enhanced = enhanced[1:-1].strip()
    # If the model returned multiple lines, take the first non-empty one.
    enhanced = next((line.strip() for line in enhanced.splitlines() if line.strip()), enhanced)
    return {"enhanced_prompt": enhanced, "model": ENHANCE_MODEL}


@app.post("/pilot/preview")
async def pilot_preview(req: PreviewReq):
    """
    Whitelisted-operator preview against the sandbox Excel.
    SES has its own preview path (runs the executor on parsed bytes); this
    endpoint exists for the standalone smoke test.
    """
    file_path = _find_session_file(req.session_id)
    df = pd.read_excel(file_path)

    rule = req.rule
    col = rule.get("column")
    op = rule.get("operator", ">")
    val = rule.get("threshold", 0)
    compare_to = rule.get("compare_to")

    if col not in df.columns:
        raise HTTPException(400, f"Column '{col}' not in Excel. Have: {list(df.columns)}")

    OPS = {
        ">":  lambda a, b: a > b,
        "<":  lambda a, b: a < b,
        ">=": lambda a, b: a >= b,
        "<=": lambda a, b: a <= b,
        "==": lambda a, b: a == b,
        "!=": lambda a, b: a != b,
    }

    flagged = []
    for _, row in df.iterrows():
        cell = row[col]
        if op == "%>" and compare_to and compare_to in df.columns:
            base = row[compare_to]
            if base in (0, None) or pd.isna(base):
                continue
            try:
                pct = ((float(cell) - float(base)) / float(base)) * 100
                if pct > float(val):
                    flagged.append(row.to_dict())
            except (ValueError, TypeError):
                continue
            continue
        if op not in OPS:
            raise HTTPException(400, f"Unsupported operator: {op}")
        try:
            if OPS[op](float(cell), float(val)):
                flagged.append(row.to_dict())
        except (ValueError, TypeError):
            continue

    return {
        "total_rows": len(df),
        "flagged_count": len(flagged),
        "flagged_rows": flagged[:50],
        "flag_rate_pct": round(len(flagged) / len(df) * 100, 1) if len(df) > 0 else 0,
    }


@app.post("/pilot/cleanup")
async def pilot_cleanup(req: CleanupReq):
    try:
        file_path = _find_session_file(req.session_id)
        file_path.unlink()
        return {"deleted": True}
    except HTTPException:
        return {"deleted": False, "reason": "already cleaned"}


@app.post("/chat/ask")
async def chat_ask(req: AskReq):
    file_path = _find_session_file(req.session_id)
    parsed = _parse_excel(file_path)
    prompt = f"""You are an audit data analyst.
Answer using ONLY the Excel data below. Be specific with numbers and project names.
If the answer isn't in the data, say so plainly.

Excel data:
{parsed['markdown'][:5000]}

Question: {req.question}

Answer:"""
    answer = _ask_qwen(prompt, temperature=0.3)
    return {"question": req.question, "answer": answer.strip()}


# ── ANALYTICS (NEW) ────────────────────────────────────────────────
# These routes serve the in-app Analytics Workbench. The API ships rows
# (filtered by user's process scope) with each request — the sidecar never
# reaches into the SES database directly.

import asyncio
from typing import List, Optional, Dict, Any

# We import the agent module lazily so the existing /pilot routes still work
# even when the new dependencies (duckdb) are missing during a partial install.
try:
    from agent import stream_chat, query_sql  # type: ignore[import-not-found]
    _AGENT_OK = True
except Exception as _e:  # pragma: no cover - sidecar starts even if duckdb missing
    _AGENT_OK = False
    _AGENT_ERR = str(_e)


class MaterializeReq(BaseModel):
    process_code: str
    function_id: Optional[str] = None
    version_ref: Optional[str] = None
    rows: List[Dict[str, Any]] = []


_DEFAULT_USE_STUB = os.getenv("AI_AGENT_USE_STUB", "1") not in ("0", "false", "False")


class AnalyticsChatReq(BaseModel):
    process_code: str
    function_id: Optional[str] = None
    version_ref: Optional[str] = None
    compare_to: Optional[str] = None
    question: str
    rows: List[Dict[str, Any]] = []
    use_stub: bool = _DEFAULT_USE_STUB


class SqlReq(BaseModel):
    process_code: str
    dataset_version: str
    sql: str


@app.get("/analytics/health")
async def analytics_health():
    if not _AGENT_OK:
        return {"ok": False, "agent": "unavailable", "error": _AGENT_ERR}
    try:
        ps = ollama_client.ps()
        loaded = [m.get("name") for m in (ps.get("models") or [])]
        return {"ok": True, "ollama": "up", "loaded_models": loaded}
    except Exception as e:
        return {"ok": True, "ollama": "down", "loaded_models": [], "error": str(e)}


@app.post("/analytics/chat")
async def analytics_chat(req: AnalyticsChatReq):
    """SSE stream of ChatEvent. The API proxies this to the browser."""
    if not _AGENT_OK:
        raise HTTPException(503, f"agent unavailable: {_AGENT_ERR}")

    from fastapi.responses import StreamingResponse

    async def gen():
        async for evt in stream_chat(
            question=req.question,
            process_code=req.process_code,
            function_id=req.function_id,
            version_ref=req.version_ref,
            rows=req.rows,
            use_stub=req.use_stub,
        ):
            yield f"data: {json.dumps(evt)}\n\n"
            await asyncio.sleep(0)

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/analytics/sql")
async def analytics_sql(req: SqlReq):
    if not _AGENT_OK:
        raise HTTPException(503, f"agent unavailable: {_AGENT_ERR}")
    try:
        return {"rows": query_sql(req.process_code, req.dataset_version, req.sql)}
    except ValueError as e:
        raise HTTPException(400, str(e))


class AnomalyDetectReq(BaseModel):
    rows: List[Dict[str, Any]] = []
    columns: Optional[List[str]] = None


@app.post("/analytics/anomalies/ml")
async def analytics_anomalies_ml(req: AnomalyDetectReq):
    """ML overlay: returns numeric outliers (IsolationForest + z-score)."""
    try:
        from tools.anomaly import detect_numeric_outliers  # local import — avoids loading at boot
    except Exception as e:
        raise HTTPException(503, f"anomaly tool unavailable: {e}")
    found = detect_numeric_outliers(req.rows, req.columns)
    return {"outliers": found, "count": len(found)}
