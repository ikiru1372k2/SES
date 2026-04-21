# Manual QA checklist

Use this list before promoting a release that touches workspace routing, uploads, drafts, or versions. Adjust steps if `VITE_FEATURE_TILES_DASHBOARD` is `false` (canonical URLs use `/workspace/...` instead of `/processes/...`).

## Auth and dashboard

1. Log in with a known test user.
2. Confirm the home dashboard lists existing processes and opens a process from a card link.

## Create process and landing

3. Create a new process from the dashboard modal.
4. Confirm you land on the **tile** page (function cards), not directly inside a single file workspace.
5. With `VITE_FEATURE_TILES_DASHBOARD=false`, confirm creation navigates to `/workspace/<id>` and tiles still render.

## Tiles and uploads

6. Open each visible function tile (or a representative subset).
7. Upload a valid workbook; confirm it appears in the sidebar and survives a **full page refresh**.
8. Navigate back to the dashboard, reopen the same process, and confirm the file still appears for that tile.

## Download and audit

9. Download the original workbook from the UI.
10. Run an audit; confirm results render and severity counts look sane.
11. Leave the workspace without clicking **Save Version**; navigate away and return (or refresh). Confirm there is a **draft / restore** path or autosaved history as designed for that build (see product issue for expected behavior).

## Saved versions

12. Save a named version; confirm it appears in **Version History**.
13. Open **Version Compare** (when at least two versions exist); confirm the compare page loads and the back link returns to the correct function workspace.

## Cross-session

14. Sign out and sign back in; reopen the process and confirm server-backed files and versions still hydrate.

## Optional — collaboration

15. If members are enabled, repeat open/upload with a second user who has access and confirm isolation for processes they should not see.
