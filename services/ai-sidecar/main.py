"""SES AI sidecar — FastAPI wrapping Docling + Qwen2.5:7b. Called server-to-server by the NestJS API."""

import hmac
import os
import uuid
import json
from pathlib import Path

import ollama
import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from docling.document_converter import DocumentConverter

SANDBOX_DIR = Path(os.getenv("SANDBOX_DIR", "/tmp/ses-ai-sandbox"))
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
MODEL = os.getenv("AI_MODEL", "qwen2.5:7b")
# Smaller, snappier instruction-follower for the prompt enhancer.
ENHANCE_MODEL = os.getenv("AI_ENHANCE_MODEL", "llama3:latest")
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "20"))

SANDBOX_DIR.mkdir(parents=True, exist_ok=True)

# F2: shared-secret gate. The NestJS API is the only legitimate caller; it
# sends X-Internal-Token. Health endpoints stay open so Docker/Compose
# healthchecks (which can't carry the secret) keep working.
SIDECAR_SHARED_SECRET = os.getenv("SIDECAR_SHARED_SECRET", "").strip()
_PUBLIC_PATHS = frozenset({"/health", "/analytics/health"})

app = FastAPI(title="SES AI Service", version="1.0.0")


@app.on_event("startup")
async def _prewarm_analytics_model() -> None:
    """Best-effort: load the analytics agent model into Ollama memory at
    boot so the FIRST user question doesn't pay the ~30s cold-load. Fully
    non-blocking and failure-tolerant — never delays or breaks startup.
    Analytics-only: warms agent.AGENT_MODEL, leaves AI Pilot models alone.
    Skipped when analytics runs via the cloud provider (no local model).
    """
    import asyncio

    async def _warm() -> None:
        try:
            from agent import AGENT_MODEL, _USE_GEMINI  # type: ignore

            if _USE_GEMINI:
                return
            client = ollama.Client(host=OLLAMA_URL)
            await asyncio.to_thread(
                client.chat,
                model=AGENT_MODEL,
                messages=[{"role": "user", "content": "ok"}],
                keep_alive="30m",
                options={"num_predict": 1},
            )
        except Exception:
            # Cold first query is still correct; warm-up is an optimisation.
            pass

    asyncio.create_task(_warm())


@app.middleware("http")
async def _require_internal_token(request: Request, call_next):
    path = request.url.path.rstrip("/") or "/"
    if path in _PUBLIC_PATHS:
        return await call_next(request)
    if not SIDECAR_SHARED_SECRET:
        # Fail closed: an unconfigured secret must not mean "open to all".
        return JSONResponse(
            {"detail": "Sidecar auth not configured (SIDECAR_SHARED_SECRET unset)"},
            status_code=503,
        )
    provided = request.headers.get("x-internal-token", "")
    if not hmac.compare_digest(provided, SIDECAR_SHARED_SECRET):
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)


# F2: the API reaches the sidecar server-to-server only. No browser origin
# ever calls it directly, so CORS is locked down (no wildcard).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_methods=["POST", "GET"],
    allow_headers=["X-Internal-Token", "Content-Type"],
)

converter = DocumentConverter()
ollama_client = ollama.Client(host=OLLAMA_URL)


# F22: only these extensions are ever written to / read from the sandbox.
_ALLOWED_EXTS = frozenset({"xlsx", "xlsm", "xls", "csv"})


def _validated_session_id(session_id: str) -> str:
    """F17: session ids are server-minted uuid4. Reject anything else BEFORE
    it reaches a glob — `*`, `..`, path separators, etc. would otherwise
    bleed across sessions or escape SANDBOX_DIR."""
    try:
        # uuid.UUID round-trip rejects globs, traversal, wrong length.
        canonical = str(uuid.UUID(str(session_id)))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(400, "Invalid session id")
    return canonical


def _safe_ext(filename: str | None) -> str:
    """F22: derive a sandbox file extension from an allowlist only. Never
    let the client's filename steer the write path (no separators, no `..`)."""
    ext = ""
    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[-1].strip().lower()
    if ext not in _ALLOWED_EXTS:
        raise HTTPException(
            400, f"Unsupported file type '{ext or '(none)'}'. Allowed: {sorted(_ALLOWED_EXTS)}"
        )
    return ext


def _find_session_file(session_id: str) -> Path:
    session_id = _validated_session_id(session_id)
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
    """Same as _ask_qwen but uses ENHANCE_MODEL (default llama3:latest) for the rewrite task."""
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


class GenerateRuleReq(BaseModel):
    # session_id is optional — SES passes columns directly; smoke test uses session lookup.
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
    # F22: extension comes from an allowlist, never raw from file.filename.
    ext = _safe_ext(file.filename)
    file_path = SANDBOX_DIR / f"{session_id}.{ext}"
    # F22 defence-in-depth: the resolved path must stay inside SANDBOX_DIR.
    if SANDBOX_DIR.resolve() not in file_path.resolve().parents:
        raise HTTPException(400, "Invalid upload path")
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
    # Strip preambles/quotes if the model ignored instructions.
    for prefix in ("Output:", "output:", "Rewritten:", "Rewrite:"):
        if enhanced.lower().startswith(prefix.lower()):
            enhanced = enhanced[len(prefix):].strip()
    if (enhanced.startswith('"') and enhanced.endswith('"')) or (
        enhanced.startswith("'") and enhanced.endswith("'")
    ):
        enhanced = enhanced[1:-1].strip()
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


# Analytics routes: API ships scope-filtered rows per request; sidecar never touches the SES DB.

import asyncio
from typing import List, Optional, Dict, Any

# Lazy import so /pilot routes still work if duckdb is missing.
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
