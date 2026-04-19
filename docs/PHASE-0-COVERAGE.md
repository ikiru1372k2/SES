# Phase 0 — Test Coverage Report

Generated: 2026-04-18  
Method: V8 coverage via `NODE_V8_COVERAGE` + `tsx --test`  
Coverage metric: function-range coverage (V8 native; line coverage is an approximation)

---

## packages/domain — 17 tests, 17 pass, 0 fail

| File | Coverage | Lines | Notes |
|------|----------|-------|-------|
| `scheduleHelpers.ts` | 80% | 71 | Timezone-fix path untested |
| `managerAnalytics.ts` | 71% | 44 | `chronicSlowResponder` edge paths missing |
| `auditRules.ts` | 62% | 91 | Some rule branches untested |
| `notificationBuilder.ts` | 60% | 267 | Attachment/edge paths missing |
| `id.ts` | 55% | 6 | Collision-detection branch |
| `auditPolicy.ts` | 42% | 39 | Several policy predicates untested |
| `workbook.ts` | 34% | 258 | Large parser; many branch paths uncovered |
| `auditEngine.ts` | 32% | 263 | Core logic; many rule combos uncovered |
| `anomaly.ts` | 0% | 22 | No tests — never loaded |
| `reporting.ts` | 0% | 44 | No tests — never loaded |
| `tracking.ts` | 0% | 47 | No tests — never loaded |
| `severity.ts` | 0% | 13 | Constants only — low risk |
| `types.ts` | 0% | 313 | Type declarations only — no runtime |
| `index.ts` | 0% | 13 | Re-exports only — no runtime |

---

## apps/api — 26 tests, 26 pass, 0 fail

| File | Coverage | Lines | Notes |
|------|----------|-------|-------|
| `signed-links/signed-link-token.service.ts` | 68% | ~120 | Token edge paths missing |
| `realtime/presence.registry.ts` | 50% | ~100 | Eviction / stale-socket paths missing |
| `realtime/realtime.gateway.ts` | 0% | ~150 | No tests (needs live Socket.IO) |
| `audits.service.ts` | 0% | ~200 | No tests |
| `auth.service.ts` | 0% | ~180 | No tests |
| `processes.service.ts` | 0% | ~250 | No tests |
| `signed-links/signed-link.service.ts` | 0% | ~200 | No tests |
| `signed-links/public-response.service.ts` | 0% | ~180 | No tests |
| *(all other API service/controller files)* | 0% | — | No tests |

---

## Files with < 50% line coverage

| File | Coverage | Risk |
|------|----------|------|
| `packages/domain/src/auditEngine.ts` | 32% | HIGH — core audit logic, 263 lines |
| `packages/domain/src/workbook.ts` | 34% | HIGH — Excel parser, 258 lines |
| `packages/domain/src/anomaly.ts` | 0% | MEDIUM — effort anomaly detection |
| `packages/domain/src/reporting.ts` | 0% | MEDIUM — HTML report (XSS escaping) |
| `packages/domain/src/auditPolicy.ts` | 42% | MEDIUM — policy predicates |
| `apps/api/src/realtime/presence.registry.ts` | 50% | MEDIUM — eviction paths |

---

## Top-5 priority files for new tests

| Rank | File | Why |
|------|------|-----|
| 1 | `packages/domain/src/auditEngine.ts` | Most complex domain logic (263 lines, 32%); bugs here produce wrong audit results |
| 2 | `packages/domain/src/workbook.ts` | Complex Excel parsing with many edge cases (258 lines, 34%) |
| 3 | `packages/domain/src/anomaly.ts` | Zero coverage; used for effort-delta detection; simple enough to test fully |
| 4 | `packages/domain/src/reporting.ts` | Zero coverage; HTML generation with XSS-escape logic that must be correct |
| 5 | `packages/domain/src/auditPolicy.ts` | Policy predicates at 42% — incorrect policy decisions affect all audits |

---

## Notes

- **API coverage is extremely low** because all services depend on Prisma (DB), Redis, or S3 — they require integration/e2e tests rather than unit tests. Section 7 focuses on pure-logic domain files where unit tests give genuine value.
- The `web` workspace has no test runner configured; frontend coverage is out of scope for Phase 0.
- Coverage files (`packages/domain/coverage/`, `apps/api/coverage/`) were deleted after reporting.
