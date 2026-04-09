# Effort Workbook Auditor

This project now has two ways to use the auditor:

1. CLI audit for local workbook files
2. Excel task-pane add-in for real Excel usage

## What it does

- Scans every worksheet in the workbook that matches the effort template
- Skips exact duplicate/reference tabs such as copied `Summary` sheets
- Applies effort-specific audit rules
- Writes back:
  - `Audit Status`
  - `Audit Severity`
  - `Audit Notes`
- Highlights flagged rows directly in Excel
- Generates PM-grouped notification previews
- Saves JSON snapshots and preview links through the local server

## Local setup

```bash
npm install
npm run create-cert
npm run server
```

## Excel add-in files

- Manifest: `manifest.xml`
- Task pane: `public/taskpane.html`
- Office.js client: `public/taskpane.js`

## Sideload into Excel

1. Start the local server with `npm run server`
2. Make sure the server is reachable at `https://localhost:3210/taskpane.html`
3. Open Excel
4. Go to `Insert` and then `My Add-ins`
5. Choose the option to upload a custom add-in manifest
6. Select `manifest.xml` from this project
7. Open the `Workbook Audit` command from the ribbon
8. In the task pane click `Scan Workbook`, then `Run Audit`

## CLI mode

```bash
npm run audit -- --workbook effort_sample_data.xlsx
npm test
```

## Output

- Audited workbook: `output/effort_sample_data.audited.xlsx`
- Preview HTML files: `output/previews`
- Snapshots: `output/snapshots`
