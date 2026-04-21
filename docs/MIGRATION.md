# Migration and rollout

This document complements [CLAUDE.md](../CLAUDE.md) (workspace restructure epic) and captures **routing**, **storage**, and **phased delivery** expectations for operators and developers.

## Workbook storage (BYTEA, not S3)

Workbook bytes and related payloads are stored in **PostgreSQL** via Prisma `Bytes` fields (for example `WorkbookFile` and file-version tables). There is **no S3 dependency** for the core upload path in this repository: size and memory planning should assume the API and database hold file content directly.

## Feature flag: `VITE_FEATURE_TILES_DASHBOARD`

| Value | Behavior |
|--------|-----------|
| Unset or any value except `false` | **Tile dashboard** — canonical client routes use `/processes/:processId`, function workspace under `/processes/:processId/:functionId`. `/workspace/:processId` redirects into `/processes/...`. |
| `false` | **Legacy-primary URLs** — tile dashboard and workspace live under `/workspace/...`. `/processes/...` redirects to the matching `/workspace/...` path so old bookmarks keep working. |

Set the variable in `apps/web/.env` for local Vite, or export it in the environment used for `vite build` / CI image builds.

## Phased delivery (P0–P6-style map)

The epic is tracked as **issues** in [CLAUDE.md](../CLAUDE.md). The table below is a rollout-oriented view; issue numbers in the doc are the source of truth for implementation detail.

| Phase | Scope (CLAUDE.md) | Rollout note |
|-------|-------------------|--------------|
| P0 | Baseline / inventory | Confirm current API and Prisma schema match deployed DB before changing auth or file paths. |
| P1 | Issue 1 — Tile landing + shared `Workspace` routing | Ship tile page + `/processes` (or `/workspace` when flag is `false`) before deep persistence refactors. |
| P2 | Issue 1A — Per-function analysis boundaries | Additive schema/API; safe to deploy behind feature work as long as API remains backward compatible. |
| P3 | Issues 2–3 — Hydration, view/download | **Data correctness** — verify uploads survive refresh; no client-only cache as sole source of truth. |
| P4 | Issue 4 — Server versions + autosave | Coordinate API + web deploy; avoid mixed versions where the client still only saves locally. |
| P5 | Issues 5–6 — Dashboard counts + tests/CI | Enable automated regression coverage before widening user access. |
| P6 | Single-workspace “Run analysis” flow (Additional Feature Plan) | Optional product track; gate on UX sign-off separately from P1–P5. |

## Staging and production gates

- **48 hours on staging** after a migration or auth change: run [docs/QA.md](./QA.md), watch error rates, and confirm Prisma migrations applied cleanly (`prisma migrate deploy`).
- **48 hours post-flip in production** (after promoting the same migration set): monitor DB size growth, upload latency, and API memory (large concurrent uploads amplify RAM use until the request completes).

## Database migrations

- Prefer **expand/contract** sequences for risky columns (add new column → dual-write → backfill → switch reads → drop old column).
- Where the team agrees, add a **`down.sql`** next to Prisma’s `migration.sql` in new migration folders for documented rollback. **Do not rewrite** already-applied migration history without explicit DBA / team approval.

## Related links

- [README.md](../README.md) — local Docker, env vars, `docker/postgres-init.sql`
- [docs/QA.md](./QA.md) — manual regression checklist
