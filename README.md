# SES - Smart Escalation System

SES is a local-first web application for auditing effort planning Excel workbooks, identifying overplanning and missing planning risks, preparing manager notifications, and tracking escalation progress.

The app replaces the earlier Excel add-in approach. Users do not need to install or inject an Office add-in. They open SES in a browser, upload workbooks, run the audit, save process versions, compare audit cycles, and download audited workbook outputs.

## Table Of Contents

- [Purpose](#purpose)
- [Current Application Type](#current-application-type)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Core Workflow](#core-workflow)
- [Pages And Features](#pages-and-features)
- [Audit Policy](#audit-policy)
- [Data Persistence](#data-persistence)
- [Run Locally](#run-locally)
- [Run With Docker](#run-with-docker)
- [Build And Test](#build-and-test)
- [Network Access](#network-access)
- [GitHub And Ignored Files](#github-and-ignored-files)
- [Troubleshooting](#troubleshooting)

## Purpose

SES helps QGC or audit users answer these questions from effort planning workbooks:

- Which projects are overplanned?
- Which projects have no planning or missing effort values?
- Which project managers need notification?
- Which managers have already been contacted through Outlook or Teams?
- What changed between audit versions?
- What changed between two different process cycles, for example May vs June?

The product is designed for controlled local or internal use. It does not require a backend database, cloud hosting, or Office add-in deployment.

## Current Application Type

This repository is now a browser-based Vite React app.

It is not:

- An Office add-in.
- An Excel taskpane extension.
- An Express backend application.
- A CLI audit pipeline.
- A certificate-based localhost add-in project.

The browser entry is still named `taskpane.html` only to keep the existing URL stable:

```text
http://localhost:3210/taskpane.html
```

## Tech Stack

| Area | Technology | Purpose |
| --- | --- | --- |
| Frontend | React 18 | Main UI framework |
| Language | TypeScript | Type-safe app and audit logic |
| Build tool | Vite 5 | Local dev server and production build |
| Routing | React Router v6 | Dashboard, workspace, compare pages |
| State | Zustand | Process, file, audit, version, tracking state |
| Excel parsing | SheetJS `xlsx` | Read uploaded Excel files and generate audited workbook downloads |
| Charts | Recharts | Analytics and trend charts |
| Notifications | react-hot-toast | Success, warning, and error messages |
| Icons | lucide-react | UI icons |
| Styling | Tailwind CSS | Utility-first styling |
| Local persistence | Vite middleware + JSON file | Saves process data to `data/ses-data.json` during local dev |
| Browser fallback | localStorage | Fallback persistence if local file API is unavailable |
| Tests | Node test runner + tsx | Parser, audit, and comparison tests |
| Container | Docker | Optional one-command local container runtime |

## Project Structure

```text
excel_audit_add_ins/
  assets/
    Logo.png

  src/
    components/
      dashboard/
        CompareProcesses.tsx
        CreateProcessModal.tsx
        ProcessCard.tsx
      layout/
        AppShell.tsx
        TopBar.tsx
      shared/
        Badge.tsx
        BrandMark.tsx
        EmptyState.tsx
        ErrorBoundary.tsx
        MetricCard.tsx
        ProgressBar.tsx
        StatusBadge.tsx
      workspace/
        AnalyticsTab.tsx
        AuditResultsTab.tsx
        FilesSidebar.tsx
        NotificationsTab.tsx
        PreviewTab.tsx
        SheetList.tsx
        TrackingTab.tsx
        VersionHistoryTab.tsx
        WorkspaceShell.tsx

    lib/
      auditEngine.ts
      auditPolicy.ts
      excelParser.ts
      notificationBuilder.ts
      storage.ts
      types.ts

    pages/
      Dashboard.tsx
      Workspace.tsx

    store/
      useAppStore.ts

    App.tsx
    index.css
    main.tsx
    vite-env.d.ts

  test/
    audit.test.ts

  taskpane.html
  vite.config.ts
  tailwind.config.js
  postcss.config.js
  tsconfig.json
  package.json
  package-lock.json
  Dockerfile
  .dockerignore
  .gitignore
```

## Core Workflow

1. Create a process, such as `May 2026 Audit`.
2. Upload one or more Excel workbooks.
3. SES detects valid effort sheets and duplicate/reference sheets.
4. Preview workbook rows in the browser.
5. Select audit scope:
   - Audit all valid sheets.
   - Audit selected valid sheets.
6. Run the QGC audit.
7. Review audit results and explanations.
8. Save a named version with notes.
9. Generate Outlook, `.eml`, or Teams notification drafts.
10. Track manager escalation status in the Tracking tab.
11. Compare versions within the process or compare one process/version against another.
12. Download an audited workbook with audit columns appended.

## Pages And Features

### Dashboard

Route:

```text
/
```

Main purpose:

- View all audit processes.
- Create a new process.
- Open a process workspace.
- Edit process name and description.
- Delete a process.
- Navigate to cross-process comparison.

Process cards show:

- Process name and description.
- Uploaded file count.
- Saved version count.
- Latest audit date.
- Latest flagged rows and issue count.
- Severity distribution summary.

### Workspace

Route:

```text
/workspace/:id
```

Main purpose:

- Work inside one audit process.
- Upload workbooks.
- Preview sheets.
- Run audit.
- Save versions.
- Generate notifications.
- Track escalation progress.
- Review analytics.

Top actions:

- `Run Audit` or `Re-run Audit`
- `Save Version`
- `Download`

The left sidebar contains:

- Workbook upload area.
- Uploaded workbook list.
- Active workbook selector.
- Valid/skipped sheet counts.
- Sheet selector.
- Audit scope selector.

### Preview Tab

The Preview tab is the landing tab for a process workspace.

It shows:

- Workbook name.
- Sheet tabs.
- Sheet status: valid, duplicate, invalid.
- Selected/skipped state.
- Row count.
- Excel-like preview table.

Header detection is aggressive. SES scans the first rows of a sheet and finds the best header row instead of blindly assuming row 1 is the header. This supports workbooks that have title or banner rows before the actual data table.

### Audit Results Tab

This tab shows the audit outcome after running the audit.

It includes:

- Summary metric cards.
- Policy summary.
- Warning when policy changed after the last audit.
- Sheet coverage table.
- Issue filters.
- Search.
- Export CSV.
- Explainable issue table.
- Expandable row details.
- QGC Settings drawer.

Issue table columns:

- Severity
- Project No
- Project
- Manager
- Sheet
- State
- Effort
- Rule
- Reason

Each issue includes:

- Rule name.
- Category.
- Exact reason.
- Threshold label.
- Recommended action.

### QGC Settings Drawer

Available only from the Audit Results tab.

Visible production settings focus on:

- Overplanning threshold.
- Missing effort detection.
- Zero effort detection.

Advanced rules are kept separate:

- Missing manager.
- In Planning with effort.
- On Hold with effort.

Saving or resetting settings does not rewrite existing audit results automatically. Users must re-run the audit so saved versions remain traceable to the policy used at the time.

### Notifications Tab

This tab groups flagged issues by project manager.

Features:

- PM grouped draft cards.
- Email preview.
- Template theme selector.
- Deadline field.
- Copy notification text.
- Open Outlook/default mail app through `mailto:`.
- Download `.eml` fallback draft.
- Open Teams deep link.
- Send All general notification to all flagged manager emails.

Browser limitation:

JavaScript in a browser cannot safely automate the desktop Outlook app directly. SES uses `mailto:` links to open the user's configured default mail app and `.eml` downloads as a fallback.

### Tracking Tab

This tab monitors escalation progress by manager.

It uses a compact pipeline layout:

- Not contacted.
- Outlook sent.
- Teams sent.
- Resolved.

Each manager card shows:

- Manager name.
- Email.
- Flagged project count.
- Outlook count.
- Teams count.
- Last contact date.
- Current stage.
- Progress percentage.

Actions:

- Mark Outlook sent.
- Mark Teams sent.
- Mark Resolved.
- Reopen manager notification draft.

Tracking updates automatically when notification actions are used.

### Version History Tab

This tab stores audit snapshots for the current process.

Each version contains:

- Stable version ID.
- Version number.
- Version name.
- Notes.
- Created date.
- Audit result.
- Audit policy snapshot.

Version IDs follow this format:

```text
{processId}-v{versionNumber}
```

Users can:

- Load a saved version.
- Download audited workbook output.
- Compare two versions within the same process.

### Analytics Tab

This tab provides process health and trend views.

It includes:

- File count.
- Version count.
- Latest flagged rows.
- Open follow-ups.
- Severity distribution.
- Issue trend chart.
- Top managers by flagged rows.

### Compare Processes Page

Route:

```text
/compare
```

Main purpose:

- Compare one saved process version against another saved process version.

Example:

- From: `May 2026 Audit`, version `May Review - V10`
- To: `June 2026 Audit`, version `June Review - V3`

Comparison output includes:

- New issues.
- Resolved issues.
- Changed issues.
- Unchanged issues.
- Manager changes.
- Effort changes.
- Project state changes.

Users can export comparison results.

## Audit Policy

The default QGC policy is intentionally simple.

Default production controls:

- Overplanning: effort greater than `900` hours.
- Missing effort: enabled.
- Zero effort: enabled.

Primary categories:

- `Overplanning`
- `Missing Planning`
- `Other`

Example reasons:

```text
Effort is 920h, above the configured overplanning threshold of 900h.
Effort value is missing.
Effort is 0; confirm whether planning is pending or intentionally zero.
```

Saved versions keep a copy of the policy used for that audit. This makes audit history traceable even if the current process policy changes later.

## Data Persistence

SES is local-first.

During `npm run dev`, Vite exposes a local file API:

```text
GET /api/local-db
PUT /api/local-db
```

The file database is:

```text
data/ses-data.json
```

This file stores:

- Processes.
- Uploaded workbook data.
- Active workbook ID.
- Sheet metadata.
- Latest audit result.
- Saved versions.
- Audit policy settings.
- Notification tracking state.

The browser also writes a fallback copy to localStorage:

```text
effort-auditor-data
```

UI state such as last active process is stored in:

```text
effort-auditor-ui
```

### Persistence Rules

- If the app is run with `npm run dev`, data is saved to `data/ses-data.json`.
- If the local file API is unavailable, data falls back to browser localStorage.
- If the app stops and starts again, saved processes load from `data/ses-data.json`.
- If the browser cache is cleared, file DB data still remains in `data/ses-data.json`.
- If `data/ses-data.json` is deleted, the app starts with an empty process list.

### Important Data Note

The `data/` folder is ignored by Git because it contains local user audit data. Do not push it to GitHub.

## Run Locally

### Prerequisites

Install:

- Node.js 20 or later.
- npm.

Recommended:

- Node.js 22 LTS.

Check versions:

```powershell
node -v
npm -v
```

### Clone

```powershell
git clone <your-repository-url>
cd msg-addo\excel_audit_add_ins
```

If your repository is already cloned, go directly to:

```powershell
cd C:\Users\basavk\Desktop\msg-addo\excel_audit_add_ins
```

### Install Dependencies

```powershell
npm install
```

### Start App

```powershell
npm run dev
```

Open:

```text
http://localhost:3210/taskpane.html
```

Stop the app:

```text
Ctrl+C
```

### Local Network Access

The dev script uses:

```text
vite --host 0.0.0.0
```

That means the app can listen on the machine network IP, for example:

```text
http://10.144.129.250:3210/taskpane.html
```

Other users can reach it only if:

- They are on the same network or VPN.
- Windows Firewall allows port `3210`.
- Your organization network does not block peer-to-peer access.
- Your machine is awake and the dev server is running.

## Run With Docker

### Prerequisites

Install and start:

- Docker Desktop.
- Docker Linux engine.

Check Docker:

```powershell
docker --version
docker info
```

If `docker info` fails, start Docker Desktop first.

### Build Image

```powershell
cd C:\Users\basavk\Desktop\msg-addo\excel_audit_add_ins
docker build -t ses-auditor .
```

The Dockerfile:

- Uses Node 22 Alpine.
- Installs dependencies with `npm ci`.
- Runs `npm run build` during image build.
- Exposes port `3210`.
- Runs the Vite server on `0.0.0.0`.
- Mounts `/app/data` as a persistent data volume.

### Run Container With Persistent Data

PowerShell:

```powershell
docker run --rm -p 3210:3210 -v "${PWD}\data:/app/data" ses-auditor
```

Command Prompt:

```cmd
docker run --rm -p 3210:3210 -v "%cd%\data:/app/data" ses-auditor
```

Open:

```text
http://localhost:3210/taskpane.html
```

Stop:

```text
Ctrl+C
```

### Why Docker Runs Vite

The local file database is implemented as Vite middleware in `vite.config.ts`. Running the Vite server keeps the local file database endpoint available:

```text
/api/local-db
```

This is useful for the current self-automation version because it keeps persistence simple and local.

## Build And Test

Run all verification commands from the app root:

```powershell
cd C:\Users\basavk\Desktop\msg-addo\excel_audit_add_ins
```

### Type Check

```powershell
npm run typecheck
```

### Tests

```powershell
npm test
```

Tests cover:

- Workbook parsing.
- Header detection.
- Duplicate sheet detection.
- QGC audit rules.
- Cross-process comparison deltas.

### Production Build

```powershell
npm run build
```

Build output is generated in:

```text
dist/
```

The `dist/` folder is ignored by Git.

### Preview Build

```powershell
npm run preview
```

Open:

```text
http://localhost:3210/taskpane.html
```

Note: preview mode is useful for checking the static build. For normal local usage with JSON file persistence, prefer `npm run dev`.

## Network Access

For another colleague to access the app from your machine:

1. Start the app:

   ```powershell
   npm run dev
   ```

2. Find the network URL printed by Vite:

   ```text
   Network: http://<your-ip>:3210/
   ```

3. Share:

   ```text
   http://<your-ip>:3210/taskpane.html
   ```

4. If they cannot open it:

   - Check both machines are on the same network.
   - Check VPN restrictions.
   - Allow port `3210` in Windows Firewall.
   - Confirm your app is still running.
   - Confirm your IP did not change.

## GitHub And Ignored Files

The repository should contain source code and configuration only.

Ignored local/generated files:

- `node_modules/`
- `dist/`
- `output/`
- `certs/`
- `data/`
- `*.xlsx`
- `*.xlsm`
- `*.xls`
- `~$*.xlsx`
- `.env`
- `.env.*`
- logs

This prevents pushing:

- Installed dependencies.
- Local audit database.
- Uploaded workbooks.
- Sample workbooks.
- Excel lock files.
- Old add-in output folders.
- Build output.

If a generated file was already tracked before `.gitignore` was added, remove it from Git tracking without deleting the local file:

```powershell
git rm --cached <file-or-folder>
```

Example:

```powershell
git rm -r --cached node_modules data dist output certs
git rm --cached effort_sample_data.xlsx
```

## Troubleshooting

### Port 3210 Is Already In Use

Stop the existing server with `Ctrl+C`, or find the process using the port.

PowerShell:

```powershell
netstat -ano | findstr :3210
```

### Docker Build Cannot Connect To Engine

If you see an error about `dockerDesktopLinuxEngine`, Docker Desktop is not running.

Fix:

1. Start Docker Desktop.
2. Wait until the engine is ready.
3. Run:

   ```powershell
   docker info
   ```

4. Re-run:

   ```powershell
   docker build -t ses-auditor .
   ```

### Data Disappeared

Check:

- Is `data/ses-data.json` still present?
- Did you run from the correct project root?
- Did you mount the `data` folder when running Docker?
- Did the browser fall back to a different localStorage profile?

Correct project root:

```text
C:\Users\basavk\Desktop\msg-addo\excel_audit_add_ins
```

### Excel Temporary File Cannot Be Deleted

Files like this are created by Excel:

```text
~$effort_sample_data.xlsx
```

Close Excel or any workbook preview using the file, then delete it. These files are ignored by Git.

### Tests Fail Because Node Cannot Spawn

On some locked-down Windows environments, test or build commands can fail with `spawn EPERM`.

Try:

- Running PowerShell as a normal user outside restricted terminals.
- Closing antivirus prompts.
- Running the command again.
- Ensuring dependencies were installed with `npm install`.

## Maintainer Notes

- Keep the project root as `excel_audit_add_ins` unless the folder is renamed later.
- Keep user data in `data/ses-data.json`.
- Keep workbook uploads out of Git.
- Keep audit logic in `src/lib`.
- Keep UI pages and tabs under `src/components` and `src/pages`.
- Keep Docker data mounted to `/app/data` for persistence.
