# Architecture

SES is a local-first React application for workbook audit workflows.

## Layers

- `src/lib`: pure business logic and storage adapters.
- `src/store`: Zustand state, persistence coordination, and user actions.
- `src/components` and `src/pages`: UI composition.

## Persistence

- Process metadata, versions, tracking, comments, and policies persist through Zustand.
- Large workbook `rawData` is stored in IndexedDB through `src/lib/blobStore.ts`.
- The Vite-only `/api/local-db` endpoint saves metadata to `data/ses-data.json` during local development.
- Production Docker serves static files with nginx and does not expose `/api/local-db`.

## Audit Execution

`src/lib/auditEngine.ts` remains pure and testable. Browser audits run through `src/lib/auditRunner.ts`, which uses a Web Worker in supported browsers and falls back to direct execution where workers are unavailable.

## Bundle Strategy

- `exceljs` is dynamically imported only when parsing or downloading workbooks.
- Analytics/Recharts are loaded lazily when the Analytics tab is opened.

## Deployment

The Docker image is multi-stage:

1. Node builds `dist/`.
2. nginx serves static assets as a non-root user.
3. nginx falls back to `index.html` for browser routes.
