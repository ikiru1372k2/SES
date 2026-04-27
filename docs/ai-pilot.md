# AI Pilot — Operations & Usage

Admin-only feature that lets admins author audit rules in plain English. The LLM (qwen2.5:7b via a separate FastAPI service) generates structured rule JSON, the admin previews it on a sandbox workbook, and on confirm the rule runs alongside hardcoded engines on every future audit.

## What it ships

- `/admin/ai-pilot` and `/admin/ai-pilot/:functionId` — admin-gated React routes
- 6-step sandbox modal: upload sample → (pick sheet) → describe → generate → review → preview → save
- Three-pane management UI (engine rules read-only, AI rules with pause/resume/archive, rule detail with audit log)
- AI rules execute via `runAiPilotRules()` in `@ses/domain`, called from `audits.service.ts` alongside the hardcoded engines and merged via `mergeAuditResults()`
- Issues from AI rules flow through the same Escalation Center / notification pipeline; tagged with the `AiBadge` "AI" pill in the audit results table
- Per-function prompt examples (3-4 prefilled, served via API for hot-swap without UI deploy)
- Lite escalation preview in step 6 — counts manager assignments without writing

## External dependency: the AI service

A separate FastAPI service must be running at `AI_SERVICE_URL` (default `http://localhost:8000`). It wraps:

- IBM Docling for Excel parsing
- qwen2.5:7b via Ollama for rule generation

The service lives outside this repo (e.g. `~/ses-ai-test/`). Endpoints SES expects:

| Method | Path | Purpose |
|---|---|---|
| GET    | `/health`         | Liveness check |
| POST   | `/pilot/upload`   | Optional: returns Docling-parsed preview markdown for the upload step |
| POST   | `/pilot/generate` | English description → rule JSON `{ spec: AiRuleSpec }` |

If the AI service is down:
- `/admin/ai-pilot/sandbox/.../generate` returns `503 ServiceUnavailableException`; UI shows friendly toast.
- Audit runs continue normally — `loadActiveSpecs()` reads from Postgres only, never calls the AI service. Engines run, AI rules run on cached specs, results merge.

## Operator vocabulary (v1)

JSON-rule executor supports a whitelisted operator set:

| Operator | Purpose |
|---|---|
| `>` `<` `>=` `<=` `==` `!=` | Numeric / equality comparison |
| `%>` | Cell exceeds compareTo column by more than N percent (numeric, same row) |
| `contains` `startsWith` `endsWith` | Case-insensitive substring match |
| `isBlank` `isMissing` `isNotMissing` | Null / whitespace check |
| `isOneOf` | Membership against `values: []` |
| `and` `or` | Composition (max nesting depth = 2) |

Anything richer (regex, math expressions, cross-row aggregates) is **out of v1**. The LLM is told what's available; UX surfaces unsupported asks via the malformed-JSON path.

## Schema

- `AuditRule.source` — `'system'` (hardcoded) or `'ai-pilot'` (AI-authored)
- `AuditRule.status` — `'active'` / `'paused'` / `'archived'` (active filter applied at audit time)
- `AiPilotRuleMeta` — sibling table: description, logic JSON, flagMessage, authoredById, sourceSessionId, llmModel, llmRawResponse
- `AiPilotSandboxSession` — uploaded bytes + 24h TTL; cleaned by cron every 6h
- `AiPilotAuditLog` — every sandbox/rule action with actor + payload (preview logs are summary-only, not full row data)

## Quality gates

- Mandatory preview before save (UI disables button + backend rejects 400 without `previewedAt`)
- Editing the spec after preview clears `previewedAt`, forces re-preview
- Spec validation: `validateSpec()` rejects depth >2, unknown operators, missing required fields
- Rule code namespacing: `ai_<ulid>` so AI rules cannot collide with engine `RUL-*` codes

## Failure modes

| Scenario | Behavior |
|---|---|
| FastAPI down at sandbox time | UI toast: "AI service unavailable" |
| FastAPI down at audit time | `loadActiveSpecs` reads from Postgres only — zero impact |
| LLM returns malformed JSON | Step 4 shows raw response card, "Try a different prompt" |
| Spec references unknown column | Preview returns `unknownColumns: []` warning; rule executes silently (matches no rows) on real audits |
| AI executor throws | Wrapped in try/catch; engine result still flows through |

## Running the AI service

```bash
cd ~/ses-ai-test
./start-ai.sh   # starts uvicorn at :8000
./smoke-test.sh # end-to-end curl test
./stop-ai.sh
```

Set `AI_SERVICE_URL` in `.env` if running on a different host:

```
AI_SERVICE_URL=http://localhost:8000
AI_PILOT_REQUEST_TIMEOUT_MS=60000
AI_PILOT_SANDBOX_TTL_HOURS=24
```

## Maintenance

- **Sandbox bloat** — sessions expire 24h after upload; cron reaps every 6h. If `AiPilotSandboxSession.fileBytes` ever grows past expectations, check that `AiPilotCronService` is running (`@nestjs/schedule` is registered in `AiPilotModule`).
- **Audit log growth** — indefinite retention in v1 (compliance). Revisit if `AiPilotAuditLog` exceeds 100k rows.
- **LLM raw responses** — stored in `AiPilotRuleMeta.llmRawResponse` for debugging "why did the AI generate this rule." Not exposed via the issues API.

## Future (out of scope for v1)

- Multi-turn chat refinement (one-shot only today)
- Two-admin approval workflow
- Rule effectiveness stats ("flagged N rows in last 7d")
- CSV/PDF export of rules
- Streaming progress over Realtime gateway
- Full read-only escalation projection (lite version ships v1)
