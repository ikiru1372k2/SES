# Header Fix Plan — `NSG | SES`

**Branch:** `kiran/header-fix`
**Owner:** @kiran
**Status:** Draft v2 for review — defaults locked in, awaiting final sign-off before code
**Goal:** One consistent, clean, responsive header across every authenticated page. Remove noise, fix duplicates, make the shell predictable.

---

## 1. Problem Statement

Today the header is rendered by a single `TopBar` component (`apps/web/src/components/layout/TopBar.tsx`, 365 lines), but it behaves inconsistently:

- **Not sticky** — scrolls away on long pages (Workspace, EscalationCenter).
- **Duplicate brand** — logo renders in both `TopBar` and the Dashboard hero card.
- **Duplicate context** — process name appears truncated in `TopBar` and full-width in page bodies (`ProcessTiles`, `Workspace`).
- **Duplicate metadata** — "Last run" timestamp shows in desktop `TopBar` *and* the mobile menu fallback.
- **Fragmented breakpoints** — `md:hidden`, `lg:hidden`, `xl:block` mixed without a clear rule.
- **Inconsistent page shells** — `AdminDirectory`, `EscalationTemplateAdmin`, `CompareProcesses`, `Debug` each roll their own page-level header above the `TopBar`.
- **No profile menu** — only a raw `Sign out` button; no user identity surfaced.
- **Header bloat on Workspace** — Run Audit, Save (split), Download, Download Corrected, PresenceBar, Members, "Last run" timestamp, RealtimeStatusPill, NotificationBell, SignOut all compete for right-side space.
- **Mobile handling is partial** — hamburger exists, but some controls overflow rather than collapse cleanly.

---

## 2. Design Principles

A senior-engineer lens. These are non-negotiables for the redesign.

1. **One header, one height.** `52px` fixed on desktop, `48px` on mobile. Never flexes. Never wraps.
2. **Sticky at top.** `position: sticky; top: 0; z-index: 40;` so context never scrolls off.
3. **Three zones only — Left / Center / Right.** No fourth slot. No inline stacking.
4. **Brand is immutable.** `NSG | SES` logo left, clickable → `/`, fixed in every state.
5. **Context goes in the center**, not the left. Breadcrumb or process title — never both.
6. **Max 2 primary actions + 1 overflow (`⋯`) + avatar menu on the right.** Everything else moves into overflow or page body.
7. **No metadata in the header.** Timestamps, IDs, version numbers, debug strings belong in the page body or a status pill — never in the chrome.
8. **Page-level controls stay in the page body.** If a control is only relevant to one screen, it does not belong in the global shell.
9. **One breakpoint rule.** `< md` = mobile drawer; `≥ md` = desktop layout. No more `lg` / `xl` carve-outs inside the header.
10. **One primary-CTA style.** Filled `indigo-600`. Secondary is ghost. No third variant inside the header.
11. **Header is pure chrome.** Zero business state lives in the header component. Pages push config down; header renders it.

---

## 3. Target Structure

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [NSG|SES]   ▸ Process · Function            [Primary] [⋯]   [Avatar ▾]  │
└──────────────────────────────────────────────────────────────────────────┘
   LEFT            CENTER                      RIGHT
```

### Left (fixed, identical on all pages)
- `NSG | SES` logo (BrandMark, compact variant).
- Always clickable → `/`.
- On Workspace: clicking triggers unsaved-audit confirm (existing `confirmLeave()` logic — preserve it).
- Mobile (`< md`): hamburger icon sits to the left of the logo for pages with side-nav; otherwise only the logo shows.

### Center (context; optional on Dashboard/Login)
- Breadcrumb trail, one level deep max: `Dashboard / Process name / Function name`.
- Truncates middle segments with ellipsis; last segment stays visible.
- Clickable segments navigate up; current page segment is not a link.
- Hidden on `/`, `/login`, `/respond/:token`.

### Right (actions; strictly capped)
- **At most 2 primary/secondary buttons** relevant to the current page.
- **`⋯` overflow menu** — holds every other action the page used to inline.
- `RealtimeStatusPill` and `NotificationBell` remain between the primary actions and the avatar, unchanged in function, consolidated to `w-9 h-9`.
- **Avatar button → dropdown menu**:
  - User name + email (from session).
  - `Manager Directory` (admin only).
  - `Templates` (admin only).
  - `Debug` (dev builds only).
  - `Sign out`.

---

## 4. Action Priority Matrix

Every route declares a fixed ranking: **P1** (left-most primary), **P2** (second primary), **Overflow** (items in the `⋯` menu in this order). If anything doesn't fit the P1/P2 budget on a given viewport, it is pushed into Overflow — never dropped silently.

Legend for source: **H** = currently in TopBar · **B** = currently in page body · **C** = custom page header · **NEW** = didn't exist.

| Route | Breadcrumb | P1 | P2 | Overflow (in order) | Notes |
|---|---|---|---|---|---|
| `/` Dashboard | — (hidden) | — | — | — | Page-body `Create New Process` stays in body; no header CTAs. |
| `/processes/:id` ProcessTiles | `Dashboard / <process>` | — | — | `Open Escalations` · `Version Compare` | Section nav (Tiles/Escalations) moves to in-page tab strip (B). |
| `/processes/:id/escalations` EscalationCenter | `Dashboard / <process> / Escalations` | — | — | `Broadcast` (only if unread > 0) | Filters, Bulk Composer stay in page body. |
| `/processes/:id/:fn` Workspace | `Dashboard / <process> / <function>` | **Run Audit** (H, shortcut `r`) | **Save** split (H, shortcut `s`) | `Download` · `Download Corrected` · `Members` · `Version history` · `Export JSON` | PresenceBar and "Last run" timestamp move to workspace body header strip. |
| `/processes/:id/:fn/compare` VersionCompare | `… / <function> / Compare` | — | — | `Swap versions` · `Download diff` | Version pickers + Compare button stay in body. |
| `/compare` CompareProcesses | `Dashboard / Compare` | — | — | — | Selectors + Compare button stay in body. Custom page header (C) removed. |
| `/admin/directory` AdminDirectory | `Dashboard / Manager Directory` | — | — | `Export CSV` | `Import` button moves from C → page body as primary page action. |
| `/admin/templates` Templates | `Dashboard / Templates` | — | — | — | Custom page header (C) removed. |
| `/debug` Debug (dev only) | `Dashboard / Debug` | — | — | `Copy JSON` · `Clear` | Wrapped in AppShell for the first time. |
| `/login` | — | — | — | — | Shell-less. Unchanged. |
| `/respond/:token` | — | — | — | — | Shell-less. Unchanged. |

**Rules the matrix enforces:**
- No route has more than 2 primaries. Ever.
- Dashboard has **zero** primaries — it is a launcher, actions belong on cards.
- Workspace's primary budget is reserved for `Run Audit` + `Save`. Nothing else is ever promoted to P1/P2, even temporarily (no "Save as New" as a separate primary — it remains the split-button secondary on Save).
- `Members`, `Download*`, and anything else historically in the Workspace header **always** goes to Overflow.
- Overflow order is locked per route (left-to-right as users read top-to-bottom in the menu). Coding reviewers reject diffs that reorder without a plan update.

---

## 5. Header Contract (TypeScript)

Pages do not touch header markup. They call `usePageHeader({...})` with a typed config. The header component is the only place that renders chrome.

```ts
// apps/web/src/components/layout/pageHeader.types.ts

export type Crumb = {
  label: string;
  to?: string;          // omit for the current/leaf segment
};

export type HeaderAction = {
  id: string;                       // stable key; used for analytics + overflow order
  label: string;
  icon?: LucideIcon;
  onClick: () => void;              // MUST be stable (useCallback)
  shortcut?: string;                // e.g. "r", "s"
  disabled?: boolean;
  loading?: boolean;                // shows spinner + disables
  variant?: 'primary' | 'secondary' | 'danger';
  splitMenu?: HeaderAction[];       // for split-buttons like Save / Save as new
  tooltip?: string;                 // shown when disabled to explain why
};

export interface PageHeaderConfig {
  breadcrumbs?: Crumb[];            // empty/undefined => hidden center
  primaryActions?: HeaderAction[];  // MAX length 2 — enforced at runtime with dev assertion
  overflowActions?: HeaderAction[]; // order = menu order
  showRealtime?: boolean;           // default true on authenticated routes
  showNotifications?: boolean;      // default true on authenticated routes
  leaveGuard?: () => boolean;       // optional: return false to block navigation (Workspace unsaved-audit)
}

// Usage in a page file:
usePageHeader({
  breadcrumbs: [{ label: 'Dashboard', to: '/' }, { label: process.name, to: `/processes/${id}` }, { label: fn.name }],
  primaryActions: [runAction, saveAction],
  overflowActions: [downloadAction, membersAction, versionsAction],
  leaveGuard: () => !hasUnsavedAudit,
});
```

**Enforced at runtime (dev only):**
- `primaryActions.length > 2` → throw in `<StrictMode>` so CI catches it.
- Duplicate `id` across `primaryActions` + `overflowActions` → throw.
- Missing `label` → throw.

This type *is* the contract. Changing it requires a plan update and a reviewer sign-off.

---

## 6. Component Changes

| File | Change |
|---|---|
| `apps/web/src/components/layout/TopBar.tsx` | Rewrite to the 3-zone model. Remove the `process`-prop branch — header no longer changes shape per page. Delete ~150 lines of conditional layout. |
| `apps/web/src/components/layout/AppShell.tsx` | Make `<header>` sticky. Always render `TopBar`. Drop split-rendering logic. Host `<PageHeaderProvider>`. |
| `apps/web/src/components/layout/PageHeaderContext.tsx` | **NEW.** Context + provider holding the active `PageHeaderConfig`. |
| `apps/web/src/components/layout/usePageHeader.ts` | **NEW.** Hook pages call in their top-level render; writes config into context, clears on unmount. Dev-mode invariants live here. |
| `apps/web/src/components/layout/pageHeader.types.ts` | **NEW.** The contract in §5. |
| `apps/web/src/components/layout/Breadcrumb.tsx` | **NEW.** Renders the center slot. Accepts `Crumb[]`. Truncation spec in §7. |
| `apps/web/src/components/layout/AvatarMenu.tsx` | **NEW.** Dropdown with user identity, admin shortcuts, Sign out. Initials fallback. |
| `apps/web/src/components/layout/OverflowMenu.tsx` | **NEW.** Generic `⋯` dropdown; renders `HeaderAction[]` with disabled/loading states. |
| `apps/web/src/components/shared/BrandMark.tsx` | Tweak to always render the `NSG | SES` lockup (pipe, desktop); `NSG|SES` (tight, mobile). Default to compact in header; full only on Login. |
| Each page (Dashboard, ProcessTiles, EscalationCenter, Workspace, VersionCompare, CompareProcesses, AdminDirectory, Templates, Debug) | Call `usePageHeader({ ... })`. Remove any custom page-level header JSX. |

---

## 7. Responsive & Truncation Rules

**Single breakpoint: `md` (768px).**

### `< md` (mobile, 48px tall)
- Left: hamburger (if page has side-nav) + `NSG|SES` compact logo.
- Center: breadcrumb collapses to **last segment only**. Tapping it opens a popover with the full trail.
- Right: P1 + P2 render as **icon-only** buttons (labels in `aria-label` and tooltip). If a page has >2 primaries, the rule in §4 means this never happens.
- Hamburger opens a full-height drawer with: breadcrumb trail, admin links (if admin), Sign out.

### `≥ md` (desktop, 52px tall)
- Full breadcrumb, full button labels.
- No hamburger.
- If a viewport is narrow enough (≈ `md`–`lg`) that the 2 primaries + icons don't fit: **P2 moves into Overflow**. P1 stays. This is driven by a `ResizeObserver` on the header, not CSS media queries, so it reacts to actual available width (e.g. when a side drawer is open).

### Long-name truncation (breadcrumb)
- Each crumb segment has `max-width: 24ch` on desktop, `18ch` on mobile.
- Overflow uses `text-overflow: ellipsis` with `title={fullText}` so the browser tooltip shows the full name on hover.
- On touch devices, long-press on a truncated segment opens the same popover used for the full-trail fallback.
- If the whole trail still doesn't fit, middle segments collapse to `…` first (keep first + last visible). Example: `Dashboard / … / Function X`. The `…` is a button that expands the trail in a popover.
- Segments never wrap to a second line. The header height is immutable.

---

## 8. Accessibility, Disabled/Loading, Z-Index

### Accessibility
- All interactive targets ≥ `40×40px` (WCAG 2.5.5 enhanced).
- Menus (avatar, overflow, split-button): focus trap, `Esc` closes, arrow-key navigation, `role="menu"` / `role="menuitem"`.
- Breadcrumb: real `<a>` elements; current page is `aria-current="page"`.
- Sticky header: 1px `border-gray-200` bottom border + `backdrop-blur-sm bg-white/90`.
- Logo `alt="NSG | SES — Smart Escalation System"`.
- Keyboard shortcuts preserved: `r` (Run Audit), `s` (Save as new). Shortcuts are disabled while any modal/menu is open.

### Disabled & loading states (uniform across P1, P2, Overflow)
- **Disabled button**: `opacity-50 cursor-not-allowed`, `aria-disabled="true"`, no hover affordance. If `tooltip` is set, it renders on hover/focus explaining *why* (e.g. "Save is disabled while an audit is running").
- **Loading button**: spinner replaces the icon at the same position so the button doesn't resize; label stays; `aria-busy="true"`; click is a no-op until `loading` clears.
- **Overflow menu items** respect the same `disabled`/`loading` flags. A loading overflow item shows a spinner on the right edge of its row.
- **Split-button (Save / Save as new)**: primary click and chevron click have independent disabled/loading states. If the main action is loading, the chevron stays enabled so users can still access the split menu.
- **Failure states**: if an action's `onClick` throws, the header does not catch — pages are responsible for toasting and resetting `loading`. This keeps the header stateless.

### Z-index layering policy
Reserved ranges — no component picks a z-index outside its range without a plan update.

| Layer | Range | Used by |
|---|---|---|
| Base page content | 0–9 | Everything in page body. |
| Sticky table headers, in-page sticky panels | 10–19 | `ManagerTable` sticky thead, workspace file list. |
| App chrome (sticky header, sidebar) | 30–39 | `AppShell` sidebar. |
| **Global header** | **40** | `TopBar` (single value, not a range). |
| Header-anchored popovers (avatar menu, overflow menu, breadcrumb expand) | 45–49 | Must exceed 40 to sit above the header bottom border; must stay below modals. |
| Modal dialogs (Save, Members, Resolution drawer) | 60–69 | `SaveVersionModal`, `MembersPanel`. |
| Toasts / transient notifications | 80–89 | Toast system. |
| Debug overlays | 95+ | Error boundary, dev-only. |

Anything currently using `z-50` that isn't a modal gets re-classed during Phase 1. Modals move to `z-60`.

---

## 9. Performance Guardrails

The Workspace page runs an audit, streams results, and receives typing-level updates in adjacent components. The header must not participate in that churn.

- **Stable callbacks.** Every `onClick` passed to `usePageHeader` must be wrapped in `useCallback` (or derived from a stable ref). A dev-mode check compares `action.onClick` identity across renders and `console.warn`s if it changes without a corresponding dependency change.
- **Memoized config.** The `PageHeaderConfig` object passed to `usePageHeader` is constructed with `useMemo`, keyed on the actual values the header cares about (labels, disabled/loading flags, breadcrumb labels) — not on transient state (draft text, scroll position, WS frames).
- **Context split.** `PageHeaderContext` is split into two contexts: one for the static shape (breadcrumbs, actions identity) and one for per-tick flags (disabled/loading). Sticky header re-renders only when shape changes; buttons re-render only when their own flag flips.
- **No header reads of Workspace local state.** If Workspace needs to reflect draft-dirty state in the Save button, it writes only the `disabled` flag into the header config — not the draft content itself.
- **Benchmark.** Before merging Workspace migration (Phase 2 step 4), record React Profiler traces of:
  - Typing 30 characters in an editable cell.
  - Running one full audit.
  - Receiving a broadcast WS frame.
  In all three, `<TopBar>` must not appear in the committed renders. This is a merge gate.

---

## 10. Implementation Phases

Each phase is independently reviewable and merges on its own.

### Phase 0 — Baseline (before any code)
1. **Visual regression snapshots.** Capture Playwright screenshots for every route in §4, at `360 / 768 / 1024 / 1440`, logged-in as `admin@ses.local`. Commit to `apps/web/tests/visual/baseline-old-header/`.
2. **Perf baseline.** React Profiler snapshots for the three Workspace scenarios in §9.
3. These baselines are the diff target for Phase 2 visual reviews.

### Phase 1 — Shell foundation (no visual changes per page yet)
1. Add `pageHeader.types.ts`, `PageHeaderContext`, `usePageHeader`.
2. Make `AppShell` header sticky.
3. Add `Breadcrumb`, `AvatarMenu`, `OverflowMenu`.
4. Rewrite `TopBar` to the 3-zone model, reading from context.
5. Feature-flag: `VITE_NEW_HEADER=1` enables new header at runtime. Default off.
6. Wire the new header on *one* throwaway test route behind the flag to validate end-to-end.

### Phase 2 — Page migrations (one commit per page, flag-gated)
Order is deliberate — low-risk pages first, Workspace last so we've learned the hook's ergonomics before tackling the dense one:
1. Debug (also wrap in AppShell).
2. Templates.
3. AdminDirectory.
4. CompareProcesses.
5. Dashboard (removes hero BrandMark).
6. ProcessTiles.
7. EscalationCenter.
8. VersionCompare.
9. Workspace — **blocked on perf benchmark pass (§9)**.

**Migration safety rule (enforced per PR):**
- A page must NOT ship with both an old custom page header and the new shell header visible simultaneously. Each migration PR either:
  - (a) deletes the old custom header in the same diff, or
  - (b) gates the old header behind `!VITE_NEW_HEADER` so only one renders at a time.
- Reviewers reject any PR where, with the flag on, you can see two headers stacked.
- **Visual regression checkpoint.** Each page's migration PR includes a Playwright re-run at the four breakpoints and a diff against the Phase-0 baseline attached to the PR description. Intentional differences get called out in the PR body; unintentional diffs block the merge.

### Phase 3 — Cutover & cleanup
1. Flip `VITE_NEW_HEADER` default to `true` in `.env.development` and staging.
2. Bake for ≥ 3 working days in staging with at least 2 admins and 2 auditors using it daily.
3. Delete the old `TopBar` process-branch code path and old mobile-menu code.
4. Remove hero `BrandMark` from Dashboard.
5. Remove `VITE_NEW_HEADER` flag entirely (only after §11 sign-off).

### Phase 4 — QA
1. Manual pass across all 11 routes at 360 / 768 / 1024 / 1440.
2. Keyboard-only navigation walkthrough.
3. Screen reader (VoiceOver) pass on breadcrumb + avatar menu + overflow menu.
4. Verify unsaved-audit guard still fires when clicking logo / breadcrumb segments from Workspace.
5. Verify z-index policy: open a modal, a toast, and the avatar menu simultaneously — stacking must match §8.
6. Verify performance: re-run §9 benchmarks; regression tolerance = 0 additional header commits per scenario.

---

## 11. Rollback Plan

`VITE_NEW_HEADER` is a real kill switch, not a convenience flag.

- **Kept live through Phase 3 bake** — any team member (not just the author) can flip it off in staging via the env and redeploy without code changes.
- **Removed only after** (a) Phase 4 QA passes, (b) 3 consecutive working days of staging use with zero header-related bug reports, (c) one admin and one auditor explicitly sign off in the PR thread.
- **Emergency rollback in prod.** If a post-cutover bug ships: revert the flag removal commit (single revert), redeploy, flag flips back to `false`, old header returns. Page migration commits before that do not need to revert — they're flag-safe by construction (migration safety rule §10).
- **Data safety.** The header holds no persisted state. Rollback is purely visual; no migrations, no schema, no localStorage keys introduced.

---

## 12. Out of Scope (explicitly)

- Theming / dark mode.
- Command palette (`Cmd-K`) — can layer on later using the overflow infra.
- Notifications redesign — bell stays as-is.
- Any backend / API changes.
- Login and `/respond/:token` pages — intentionally untouched.

---

## 13. Decisions Locked In

These were open questions in v1. Defaults are now chosen so implementation does not pause. Override any of them in review if you disagree; otherwise these are final.

1. **Branding lockup.** `NSG | SES` with a real pipe character (`U+007C`), 8px side-padding around the pipe. On mobile the pipe tightens to `NSG|SES` (no padding). If `Logo.png` ships later we swap it in without changing spacing.
2. **Avatar fallback.** Initials from the email local part — `gkolur@tensorkode.com` → `GK`. Background `indigo-600`, white text, `rounded-full`, `w-8 h-8`. If/when the backend returns a real `user.avatarUrl` we render that instead; no other change.
3. **Breadcrumb clickability on Workspace.** `Dashboard` → `/`. `<process>` → `/processes/:id`. `<function>` (leaf) is **not** a link (it's the current page; `aria-current="page"`). No router additions needed.
4. **Mobile Run/Save on Workspace.** Both stay visible as icon-only primaries. `Run Audit` = `▶` icon, `Save` = `💾` icon, each with `aria-label` and a long-press tooltip. Rationale: these are the reason Workspace exists; burying either in `⋯` on mobile would kneecap the page on the one viewport where it's most often used.
5. **Admin nav placement.** Admin links (`Manager Directory`, `Templates`) live **only** in the avatar dropdown. No secondary nav row under the header. Rationale: admins are a small fraction of sessions; a persistent row would cost every user a line of vertical space for a few users' convenience. Reachability via avatar is two clicks, which matches the frequency.

---

**Next step:** review §4 (matrix), §5 (contract), §9 (perf), §13 (locked defaults) first — those are the load-bearing sections. Anything you want changed there, flag in this PR thread and I'll revise before Phase 0 snapshots. Once approved, I start with Phase 0 (baseline screenshots) and Phase 1 (shell foundation behind the flag).
