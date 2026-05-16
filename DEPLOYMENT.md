# SES — Deployment & Security Operations

Operational companion to [SECURITY_REVIEW.md](SECURITY_REVIEW.md). Covers
the edge trust model (F19) and the rotation / backup / incident-response
runbook (F21). **No secrets in this file** — only where they live and how
to rotate them.

---

## 1. Required secrets (`.deploy.env`, never committed)

`docker-compose.prod.yml` now **fails closed**: `docker compose up` errors
out unless every one of these is set to a real, non-default value.

| Variable | Used by | Generate |
|----------|---------|----------|
| `SES_AUTH_SECRET_DOCKER` | API JWT + signed-link HMAC | `openssl rand -hex 32` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | Postgres + API `DATABASE_URL` | strong unique |
| `REDIS_PASSWORD` | Redis AUTH + API `REDIS_URL` | `openssl rand -hex 24` |
| `OBJECT_STORAGE_ACCESS_KEY` / `OBJECT_STORAGE_SECRET_KEY` | MinIO/S3 + API | provider or `openssl rand -hex 24` |
| `SIDECAR_SHARED_SECRET` | API ↔ AI sidecar auth (F2) | `openssl rand -hex 32` — identical on API & sidecar |
| `CLOUDFLARED_TOKEN` | Cloudflare tunnel (if `tunnel` profile) | from Cloudflare Zero Trust |

`.env` / `.env.*` / `.deploy.env` are gitignored. `.env.example` carries
**placeholders only** — never paste a real value there (CI gitleaks blocks it).

---

## 2. Edge trust model (F19) — pick ONE shape and document which

The API trusts `X-Forwarded-Proto`/`-For` from exactly one proxy hop
(`trust proxy = 1`, set in `main.ts`). That is correct **only if** nothing
untrusted can reach the API directly. Choose and record the deployment shape:

### Shape A — Tunnel-only (recommended; default compose)

- `cloudflared` runs the tunnel (`profiles: [tunnel]`); **no public origin
  IP, no inbound ports on the host**. Only `web` (nginx :3210) is published,
  and only cloudflared connects to it.
- There is no "origin" to curl. "Bypass" testing means reaching `nginx:3210`
  from inside the Docker network / a bastion, not a public address.
- Hardening checklist:
  - [ ] Cloudflare Zero Trust: tunnel locked to this connector; token rotated
        on staff offboarding.
  - [ ] WAF / rate-limit rule on `/api/v1/public/*` and `/api/v1/auth/*`.
  - [ ] Cache rule: **bypass** cache for `/api/*` (never cache API responses).
  - [ ] `/api/v1/public/respond/*` not logged at the edge (tokens in path
        until F4 long-term fix lands).

### Shape B — Public origin behind Cloudflare

- Origin reachable by IP/DNS. You **must** stop direct-to-origin requests:
  - [ ] Cloudflare **Authenticated Origin Pulls** (mTLS) enforced at nginx,
        or origin firewall allowing only Cloudflare IP ranges.
  - [ ] Same WAF / rate-limit / cache-bypass rules as Shape A.
  - [ ] Verify: `curl https://<origin-ip-direct>/api/v1/health` is rejected
        without the Cloudflare client cert.

> Record the chosen shape (A or B) in your infra notes. The §4 verification
> steps differ by shape.

---

## 3. Network exposure invariants

- Prod publishes **only** `web` (3210). Postgres/Redis/MinIO/sidecar/Ollama
  are `expose`-only on the internal `ses-network` (verified:
  `docker compose -f docker-compose.prod.yml config`).
- Redis requires a password (F18); the API URL carries it.
- The AI sidecar requires `X-Internal-Token` on every non-health route (F2)
  and runs non-root, read-only-rootfs, `cap_drop: ALL` (F3/F16).
- Dev compose binds the sidecar to `127.0.0.1` only.

---

## 4. Secret rotation runbook (F21)

General principle: secrets are compromised the moment they are committed or
shared outside `.deploy.env`. Rotate, don't rationalize.

### `SES_AUTH_SECRET` (most urgent — see F1)
1. Generate new: `openssl rand -hex 32`.
2. Update `SES_AUTH_SECRET_DOCKER` in `.deploy.env` on every environment.
3. `npm run docker:prod:up` (rolling). All existing sessions **and**
   outstanding signed-links are invalidated by design — expected.
4. Communicate that users must re-login.
5. If the old value ever reached git history, also run the **git history
   purge** — see the human checklist in SECURITY_REVIEW.md §"F1 git history
   purge". That step is destructive (history rewrite + force-push) and is
   **not** automated; it requires explicit human coordination.

### `REDIS_PASSWORD` / DB / object-storage / `SIDECAR_SHARED_SECRET`
1. Generate new value.
2. Update `.deploy.env`. For `SIDECAR_SHARED_SECRET` the API and sidecar
   read the same var — both restart together, so no skew window.
3. `npm run docker:prod:up`. For Postgres password changes, the DB
   container reads `POSTGRES_PASSWORD` on init; for an existing volume,
   rotate via `ALTER ROLE` then update `.deploy.env` in the same change.

### `CLOUDFLARED_TOKEN`
Rotate in Cloudflare Zero Trust, update `.deploy.env`, restart the
`cloudflared` service.

---

## 5. Backups, encryption at rest (F21)

- Postgres volume `ses_pg_data_prod` and MinIO volume `ses_minio_data_prod`
  hold all confidential data. Host-disk / volume encryption (LUKS, cloud
  EBS/PD encryption) is an **operator responsibility** — enable it.
- Back up Postgres (`pg_dump`) and the object store on a schedule; store
  backups encrypted and access-controlled. A backup is as sensitive as the
  live DB — same handling as production data.
- Test restore at least quarterly.

---

## 6. Incident response — leaked secret (F1-class)

1. **Contain:** rotate the affected secret immediately (§4). For
   `SES_AUTH_SECRET` this also forces global re-login (good).
2. **Assess:** determine where the value was exposed (git history, logs,
   chat, screenshot) and for how long. Treat as compromised for that whole
   window.
3. **Purge:** if in git history, follow SECURITY_REVIEW.md §F1 checklist
   (mirror-backup → `git filter-repo` → force-push → everyone re-clones).
4. **Detect:** review access/audit logs for the exposure window for misuse
   (unexpected admin sessions, signed-link redemptions, sidecar calls).
5. **Prevent:** confirm the CI gitleaks job (`.github/workflows/ci.yml`)
   would have caught it; tighten if not.
6. **Record:** write up timeline, blast radius, and follow-ups in a private
   IR ticket — not in this repo.
