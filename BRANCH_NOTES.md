# feature/realtime-and-signed-links

Two slices on top of `migration-to-aws`:

1. **Live collaboration** — Socket.IO gateway + Redis adapter + presence bar.
2. **Zero-login manager response** — HMAC signed links so managers can
   acknowledge / correct / dispute an audit flag from their inbox without
   signing in.

## What runs today

```bash
npm install
cp .env.example .env                     # if you don't already have one
docker compose up -d                     # Postgres + Redis from the existing compose file
npm run prisma:generate                  # needed once after pulling this branch (adds SignedLink model)
npm run prisma:migrate:dev -- --name realtime_and_signed_links
npm run prisma:seed                      # reuses your existing seed
npm run dev:api &
npm run dev:web
```

Open two browser tabs at `http://127.0.0.1:3210/workspace/<id>` logged in
as different seeded users — each should see the other's avatar appear in
the TopBar, and any audit / tracking / file action produces a toast in
the other tab within a few hundred milliseconds.

## Test evidence

Run locally:

```bash
npm run test --workspace @ses/domain     # 17/17 pass
npm run test --workspace @ses/api        # 26/26 pass
npm run typecheck --workspace @ses/web   # clean
```

Breakdown of the 26 API tests:

| Suite | Tests | What it proves |
|---|---|---|
| `PresenceRegistry` | 12 | join/leave/move/heartbeat lifecycle, multi-tab per-user, cross-process isolation, cleanup invariants, idempotent leave/heartbeat |
| `Realtime protocol (wire-level)` | 3 | Two real socket.io-client instances: presence.joined fan-out, presence.left on disconnect, events in process A don't leak into process B |
| `SignedLinkTokenService` | 11 | HMAC tamper detection (payload + signature), wrong-secret rejection, expiry, bogus-input safety, stable SHA-256 hash, unique jti, TTL correctness |

No new errors are introduced vs. the pre-existing state; I didn't remove or
skip any of your original tests.

## Where the slice doesn't go yet (honest gaps)

- No integration test for the `GET /public/respond/:token` → `POST` round-trip.
  That path depends on the generated Prisma client, so it has to run against
  a real Postgres. Straightforward to add on a dev machine; blocked in the
  sandbox where this branch was authored.
- No notification-builder patch yet to embed the signed URL into outgoing
  emails. Next change should wire `SignedLinkService.issue()` from
  `notifications.service.ts` so the outgoing email body contains the URL.
- The SLA engine (business-calendar-aware countdown, auto-escalation ladders,
  urgency colour on the Kanban) is a separate slice and is NOT in this branch.

## Dependencies added

Server (`apps/api`):

- `@nestjs/websockets@^11.0.0`  — MIT
- `@nestjs/platform-socket.io@^11.0.0`  — MIT
- `socket.io@^4.8.1`  — MIT
- `@socket.io/redis-adapter@^8.3.0`  — MIT
- `ioredis@^5.4.1`  — MIT

Web (`apps/web`):

- `socket.io-client@^4.8.1`  — MIT

Every dependency is permissively licensed, hosted on npmjs, and
self-contained. Nothing in this branch requires an API key, a paid
service, or access from your IT team.

HMAC signing reuses `SES_AUTH_SECRET` from `.env` — no new secret to
manage. Redis runs against the existing `ses-redis` service in
`docker-compose.yml` on port 6380; if Redis is unreachable the gateway
logs a warning and degrades to single-node mode so local dev still works.

## Commits on this branch

```
feat(api): realtime collaboration via Socket.IO gateway
feat(web): realtime client, presence bar, live toasts
test(api): presence registry + socket.io wire-level protocol
feat(api): zero-login manager response via HMAC signed links
feat(web): public /respond/:token page for signed-link responses
```

Each commit message explains its scope and contains the rationale for
design decisions (why after-commit emission, why in-memory presence, why
HMAC + DB row rather than pure JWT, etc.).
