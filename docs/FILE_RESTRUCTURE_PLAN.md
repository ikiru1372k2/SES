# File & Folder Restructure Plan

> Branch: `asv/file-restructure`
> Status: living document — updated as phases land.
> Last updated: 2026-05-15

**Location rationale.** This document lives in `docs/` because that is the
established repo convention for planning/design docs
(`docs/AUDIT_ENGINE_REWORK.md`, `docs/CROSS_FUNCTION_NOTIFICATIONS_PLAN.md`,
`docs/object-storage.md`). Operational docs (`README.md`, `deploy.sh`) stay at
root; design/migration plans go under `docs/`.

**Scope guardrail.** This work is *structure only* — moves, renames, folder
boundaries, import-path updates, test relocation, and the config changes those
moves require. No behavior changes, no logic refactors, no dependency
upgrades, no API contract changes. Any temptation to "fix that while we're
here" is out of scope and gets its own ticket.

---

## 1. Current state

### 1.1 High-level tree

```
SES/  (npm workspaces monorepo; TS project references)
├── apps/
│   ├── api/   @ses/api   — NestJS 11 backend
│   │   ├── src/           46 flat *.ts at root + 17 feature/infra folders
│   │   ├── test/          flat mirror of unit + e2e specs
│   │   └── db/            migrations + runner + seed
│   └── web/   @ses/web   — React 18 + Vite SPA
│       └── src/           components/ pages/ lib/ store/ hooks/ realtime/
├── packages/
│   └── domain/ @ses/domain — pure business logic (framework-free)
│       └── src/           functions-audit/* (well-grouped) + 23 flat root files
└── services/
    └── ai-sidecar/        Python FastAPI/gRPC sidecar (out of scope)
```

### 1.2 Pain points (summary)

- **`apps/api/src` is half-modularized.** 46 loose files at the package root
  (`audits.controller.ts` + `audits.service.ts`, `auth.*`, `files.*`,
  `tracking*.*` …) coexist with ~6 properly-encapsulated NestJS modules
  (`ai-pilot/`, `notifications/`, `object-storage/`, `pdf-processing/`).
  Two contradictory conventions in one package.
- **One god-module.** `app.module.ts` hand-registers ~30 controllers and ~40
  providers (~200 lines). It is a structural merge-conflict magnet and hides
  all inter-feature dependencies (everything can inject everything).
- **`tracking` is fragmented across 4+ locations.** Root
  `tracking.{controller,service}.ts` + root `tracking-bulk.*` + sibling
  folders `tracking-compose/`, `tracking-stage/`, `tracking-attachments/`.
  One feature, four directories.
- **DTOs are centralized, partially.** `apps/api/src/dto/` holds 7 DTO files
  for a ~23-feature surface; most features have no co-located contract and
  the central bin is non-idiomatic for NestJS.
- **Cron/lifecycle services are unscoped.** `sla-engine.service.ts` and
  `status-reconciler.service.ts` sit at the root with no owning feature.
- **API tests are a flat parallel mirror.** `apps/api/test/*.test.ts`
  imports `../src/<file>`; moving any source file breaks the test import and
  there is no locality between a unit and its spec.
- **`packages/domain/src` root is flattening.** `functions-audit/` is an
  excellent per-function structure, but 23 unrelated root files
  (`escalations.ts`, `notificationBuilder.ts`, `tracking.ts`,
  `managerAnalytics.ts` …) are an ungrouped grab-bag.

### 1.3 What is already good (do **not** touch)

- `apps/web/src` — feature-grouped `components/{auth,dashboard,workspace,…}`,
  plus `pages/ lib/ store/ hooks/ realtime/`. Idiomatic React; structurally
  sound. Only minor opportunity (see Issue 7) and it is **optional**.
- `apps/web/src/lib/{auditEngine,notificationBuilder,severity,…}.ts` are
  **re-export shims** (`export * from '@ses/domain/...'`), *not* duplicated
  logic. Earlier concern retracted — no consolidation needed.
- `packages/domain/src/functions-audit/<fn>/{engine,rules,columns,index}.ts`
  — exemplary; the model the rest of the repo should imitate.
- `@ses/domain` is correctly framework-free and consumed via the
  `@ses/domain` workspace package + path alias in web.

---

## 2. Issues to fix

1. **Flat root in `apps/api/src` (46 files).** *What:* controller/service
   pairs dumped at the package root. *Why it matters:* no feature ownership,
   no encapsulation boundary, every file is one `ls` of noise; impossible to
   reason about a feature in isolation.
2. **God `app.module.ts`.** *What:* single module declares all controllers +
   providers. *Why:* hides the dependency graph, serializes all feature work
   through one file, blocks per-feature testability and any future lazy
   composition.
3. **`tracking` spread across `src/tracking*.ts` + 3 sibling folders.**
   *Why:* a single domain concept with no single home; changes touch four
   directories; reviewers cannot see the feature surface.
4. **Centralized `src/dto/`.** *What:* contracts detached from the feature
   that owns them, and only partial coverage. *Why:* DTO + controller drift,
   non-idiomatic, unclear ownership.
5. **Unscoped lifecycle services** (`sla-engine.service.ts`,
   `status-reconciler.service.ts`). *Why:* cross-cutting cron logic with no
   declared owning feature; unclear where related changes belong.
6. **API tests are a detached flat mirror** (`apps/api/test/*`). *Why:*
   every source move breaks `../src/...` imports; no unit↔spec locality;
   the `test/*.test.ts` glob will not discover co-located specs.
7. **`packages/domain/src` root grab-bag (23 files).** *Why:* mixed
   concerns (escalations, notifications, analytics, tracking, scheduling) at
   one level; harder to navigate as the domain grows. *(Lower priority —
   it is a flat *library*, not a flat *application*; cosmetic, optional.)*

---

## 3. Target state

### 3.1 `apps/api/src` — feature-module layout ("screaming architecture")

Convention (stated assumption — see Open Questions): features live under
**`apps/api/src/modules/<feature>/`**. The `modules/` segment keeps the
package root to `main.ts`, `app.module.ts`, `load-env.ts` only and visually
separates feature code from cross-cutting `shared/`/infra code.

```
apps/api/src/
  main.ts
  app.module.ts                 # imports feature modules only (~25 lines)
  load-env.ts
  modules/
    auth/        auth.module.ts auth.controller.ts auth.service.ts
                 auth.guard.ts dto/ auth.service.spec.ts
    audits/      audits.module.ts audits.{controller,service}.ts dto/
    files/       files.module.ts files.{controller,service,repository}.ts
                 file-versions.* file-drafts.* dto/
    tracking/    tracking.module.ts
                 tracking.{controller,service}.ts
                 bulk/ compose/ stage/ attachments/
    escalations/ escalations.module.ts escalations.service.ts
                 escalations-aggregator.ts sla-engine.service.ts
    processes/   processes.module.ts processes.* process-activity.controller.ts
    issues/      rules/  functions/  templates/  exports/  versions/
    jobs/        saved-views/  activity/  in-app-notifications/
    directory/   escalation-templates/  notifications/  analytics/
    ai-pilot/    pdf-processing/  signed-links/  realtime/
    health/
  shared/                       # cross-cutting app concerns (was common/)
    guards/ pipes/ request-context.ts access-scope.service.ts …
  infra/                        # technical adapters
    db/ repositories/ object-storage/
```

Module boundary rules:

- One feature = one folder = one `*.module.ts`. The feature owns its
  controllers, services, and DTOs.
- DTOs co-locate at `modules/<feature>/dto/`. The central `src/dto/` is
  emptied and removed.
- A feature exports only what other features may inject (its `*.module.ts`
  `exports`). Cross-feature use goes through the module, not deep file paths.
- Truly shared providers (`AuthGuard`, `AccessScopeService`,
  `ProcessAccessService`, `ActivityLogService`, `IdentifierService`,
  `RealtimeGateway`, `PresenceRegistry`) live in a `SharedModule`/`CoreModule`
  that is imported where needed instead of re-declared.
- `common/` → `shared/` and `db/`+`repositories/`+`object-storage/` → `infra/`
  are **rename/move only**; deferred to a late phase because `common/` is
  imported very widely and the churn is large.

### 3.2 `apps/api/test` — co-located specs

Unit specs move next to their unit as `*.spec.ts`
(`modules/rules/rules.service.spec.ts`). The Node test runner glob widens to
discover them. **e2e specs stay** in `apps/api/test/` (they exercise the
whole app, not a unit) and become the only thing in that folder.

### 3.3 `packages/domain/src` — optional grouping (Phase 4, may be dropped)

Group the 23 root files into `escalations/ notifications/ tracking/
analytics/ scheduling/ workbook/` keeping `index.ts` as the **stable public
barrel** so `@ses/domain` consumers are unaffected. Optional and lowest
priority.

### 3.4 `apps/web/src` — keep; optional `lib/` grouping (Phase 4, optional)

Structurally fine. Optional: group the ~20 flat `lib/` files into
`lib/{domain-shims,storage,api,parsing}/`. Not required for this initiative.

---

## 4. Migration plan (phased, ordered)

Each phase is independently shippable, independently revertible, and ends
green on the full verification suite (§6). Prefer one PR per phase; within a
phase, one commit per feature folder.

### Phase 0 — Safety net (done)
- [x] Branch `asv/file-restructure`.
- [x] Capture green baseline: `npm run typecheck` (domain build + api + web).
- [x] This plan committed before any source move.

### Phase 1 — Relocation only, **DI graph unchanged** (low risk)
Move flat root files into `src/modules/<feature>/` and consolidate the
`tracking*` cluster. **`app.module.ts` keeps the same controller/provider
lists** — only import *paths* change. No `*.module.ts` per feature yet. This
delivers ~90% of the navigation benefit at near-zero behavioral risk because
the Nest DI graph is byte-for-byte identical; only `import` specifiers move.

Ordered tasks:
1. `tracking*` consolidation (worst offender, highest value) — folders
   `bulk/ compose/ stage/ attachments/` under `modules/tracking/`.
2. Remaining controller/service pairs → `modules/<feature>/`, alphabetically,
   one commit per feature.
3. Co-locate `src/dto/<x>.dto.ts` → `modules/<owner>/dto/`; delete `src/dto/`.
4. Update `app.module.ts` imports; update `apps/api/test/*` `../src/...`
   import paths to new locations.
5. Verify after **every** feature commit (typecheck is fast; full suite at
   phase end).

### Phase 2 — Introduce feature modules, slim `app.module.ts` (medium risk)
One feature at a time: add `modules/<feature>/<feature>.module.ts`
declaring that feature's controllers/providers and `exports`; replace its
entries in `app.module.ts` with the module import. Extract shared providers
into `SharedModule`. Risk: DI resolution changes — a missing `exports` or
`imports` is a runtime (not compile) failure, so **e2e suite is the gate**
for every feature in this phase.

### Phase 3 — Co-locate API unit specs (low risk)
Move `apps/api/test/<x>.test.ts` unit specs to
`modules/<feature>/<x>.spec.ts`; widen the test glob in
`apps/api/package.json`; keep e2e specs in `test/`.

### Phase 4 — Optional library grouping (low risk, may be deferred/dropped)
`packages/domain/src` root grouping behind the stable `index.ts` barrel;
optional `apps/web/src/lib/` grouping. Only if there is appetite; not
required for the initiative to be "done."

---

## 5. Import / path & config updates

- **`apps/api` has no path aliases** and `tsconfig.json` already globs
  `src/**/*.ts` + `test/**/*.ts`, so new nested folders need **no tsconfig
  change**. Only relative `import` specifiers change. This is the single
  biggest risk-reducer and is why the API can be moved purely mechanically.
- **`apps/web/tsconfig.json`** path aliases (`@ses/domain*`) are untouched —
  web is not being restructured.
- **Root `tsconfig.json`** project references (`packages/domain`, `apps/api`,
  `apps/web`) are unaffected — package roots do not move.
- **ESLint:** only `apps/web/eslint.config.js` exists; the API has no lint
  step (root `lint` runs web only). No ESLint changes needed for API moves.
- **`apps/api/package.json` scripts:** `db:*` paths (`db/runner.ts`,
  `db/seed.ts`) are unaffected. The `test`/`test:e2e` globs change only in
  Phase 3.
- **Workspace globs** (`workspaces: ["apps/*","packages/*"]`) unaffected —
  package boundaries do not move.
- **Circular-dependency strategy:** the relocation in Phase 1 cannot
  introduce cycles (no edges added/removed — only file locations). Phase 2
  introduces module edges; enforce a strict layering rule —
  `modules/* → shared/* → infra/*`, never the reverse, and feature→feature
  only via an exported module surface. Spot-check with `madge --circular`
  (dev-only, not added as a dependency) before each Phase 2 PR.
- **Mechanical move recipe** (per file, preserves git history):
  `git mv src/x.controller.ts src/modules/x/x.controller.ts`, then fix that
  file's relative imports and every importer's specifier, then `typecheck`.

---

## 6. Testing strategy

Run from repo root, in this order. "Done" = every command exits 0.

1. `npm run typecheck` — domain build + api + web (fast; run after **every**
   feature move within a phase).
2. `npm run lint` — web ESLint.
3. `npm test` — domain (node) + api (`tsx --test`) + web (vitest).
4. `npm run test:e2e --workspace @ses/api` — **the gate for Phase 2** (DI
   wiring errors are runtime, not compile-time).
5. `npm run test:components` — web component tests.
6. `npm run build` — domain + api (`tsc`) + web (vite) production build.

Definition of done for a **phase**: 1–6 all green, plus `git mv` used for
every move so history/`git log --follow` is preserved, plus the plan doc's
phase checklist updated.

CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) already runs
lint, typecheck, `npm test`, `test:e2e`, `test:components`, `npm audit`, and
`build` against real Postgres + MinIO — it is the backstop for every PR. No
CI changes are required by this initiative (the e2e/test globs change in
Phase 3 is internal to `apps/api/package.json` and CI calls the npm script,
not the glob directly).

---

## 7. Rollback

- **Granularity is the safety mechanism.** One PR per phase, one commit per
  feature folder. A bad feature move reverts with a single
  `git revert <sha>` without unwinding the whole initiative.
- Phase 1 is pure relocation — if anything is wrong it is a **compile**
  error caught by `typecheck` before commit; nothing reaches runtime.
- Phase 2 is the only phase with runtime risk; its per-feature commits each
  pass the e2e gate before the next, so a regression is bisectable to one
  feature and revertible in isolation.
- If a phase proves too costly mid-flight, ship the completed feature
  commits (they are independently valid — moves, not behavior) and re-scope
  the remainder into a follow-up; the plan's phase checklist records the
  cut line.
- Hard reset escape hatch: the branch is rebased/squashed only at the end;
  until then every step is an isolated commit on `asv/file-restructure`.

---

## 8. Open questions (need team input)

1. **`modules/` segment vs flat-at-`src/`.** Plan assumes
   `src/modules/<feature>/`. Some Nest teams prefer `src/<feature>/`
   (shallower). Assumption documented; flag if the team prefers flat.
2. **`common/` → `shared/` and infra extraction.** High import churn for a
   naming win. Plan defers it to a late phase / separate PR. Confirm whether
   it is wanted at all, or whether keeping `common/` is acceptable.
3. **Scope of Phase 2 this iteration.** Modularization (per-feature
   `*.module.ts` + slim `app.module.ts`) carries runtime DI risk. Confirm
   whether to land it now or land Phase 1 (relocation) first and schedule
   Phase 2 as its own reviewed PR — recommended default.
4. **Phase 4 appetite.** Is domain/web `lib` grouping wanted, or explicitly
   out of scope for this initiative?
5. **Owning feature for cron services.** `sla-engine` → `escalations` and
   `status-reconciler` → `tracking` is the proposed mapping. Confirm, or
   prefer a dedicated `scheduler/` feature.

---

## 9. Assumptions inferred from the repo

- Monorepo tool: **npm workspaces** (`package.json` `workspaces`), no
  Nx/Turbo/Lerna. Verified.
- Backend framework: **NestJS 11**; convention target is NestJS feature
  modules. Verified via `@nestjs/*` deps + existing `*.module.ts` files.
- Test runners: **node `--test` / `tsx --test`** (api), **node test**
  (domain), **vitest** (web). Verified via package scripts.
- TS build: **project references** + per-package tsconfig; API emits to
  `dist/`, web via Vite. Verified.
- Plan-doc convention: `docs/*_PLAN.md`, UPPER_SNAKE. Followed.
