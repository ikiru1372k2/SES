# Security

## Trust Model

SES is intended for controlled internal or demo environments. Workbook uploaders are trusted users. Do not expose `npm run dev:lan` on untrusted networks.

## Current Controls

- Known vulnerable `xlsx` dependency was removed.
- Workbook notification HTML is escaped.
- Notification preview renders safe JSX instead of raw HTML.
- `mailto:` subjects and recipients are sanitized.
- Missing manager emails block Outlook, Teams, and `.eml` actions.
- Uploads are limited to `.xlsx` / `.xlsm` and 10 MB.
- Dev local DB endpoint is localhost-oriented, origin-checked, JSON-only, body-capped, and schema-sanitized.
- Production nginx blocks `/api/local-db`.
- Docker runtime is non-root.
- nginx sends CSP, `X-Content-Type-Options`, and `Referrer-Policy` headers.

## Reporting Issues

For private repositories, report security issues directly to the maintainer. Include:

- affected commit,
- reproduction steps,
- expected impact,
- whether uploaded workbook data is involved.
