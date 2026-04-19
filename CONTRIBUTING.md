# Contributing

## Prerequisites

- Node.js 22 LTS
- Docker Desktop (PostgreSQL + Redis via `docker compose up -d`)
- A `.env` file copied from `.env.example`

## Local setup

```bash
npm install
docker compose up -d
cd apps/api && npx prisma migrate deploy --schema prisma/schema.prisma && cd ../..
npm run dev:api      # terminal 1 — API on :3000
npm run dev:web      # terminal 2 — frontend on :3210
```

## Verification before pushing

Run these from the repo root:

```bash
npm run build --workspace @ses/domain   # must produce no errors
npm run typecheck --workspace @ses/api
npm run typecheck --workspace @ses/web
npm run test --workspace @ses/domain
npm run test --workspace @ses/api
```

No lint failures, no type errors, no test failures.

## Commit style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | When |
|--------|------|
| `feat:` | New user-visible behaviour |
| `fix:` | Bug correction |
| `chore:` | Tooling, deps, CI, config |
| `docs:` | Documentation only |
| `test:` | Tests only |
| `refactor:` | Code change with no behaviour change |

Keep commits focused. One logical change per commit.

## Adding a migration

After editing `apps/api/prisma/schema.prisma`:

```bash
cd apps/api
npx prisma migrate dev --name <short-description> --schema prisma/schema.prisma
npx prisma generate --schema prisma/schema.prisma
```

Commit both the migration SQL file and the updated `schema.prisma`.

## Logging rules

- **Backend**: use `Logger` from `@nestjs/common`. Never `console.*`. See [`docs/LOGGING.md`](docs/LOGGING.md).
- **Frontend**: no `console.log` in committed code. `console.warn`/`console.error` only with a documented recovery comment.

## Adding a new API endpoint

1. Add the route to the appropriate controller (`*.controller.ts`).
2. Define request/response DTOs in `apps/api/src/dto/`.
3. Implement service logic in `*.service.ts`; inject `PrismaService` via constructor.
4. Guard the route with `@UseGuards(AuthGuard)` (already global) or mark it `@Public()` if unauthenticated access is intentional.
5. Update `apps/web/src/api/` with a typed client function.

## Dependency changes

When you add or remove packages, commit the updated `package-lock.json` together with `package.json`.

Do not use `--legacy-peer-deps` or `--force`. Resolve peer dependency conflicts explicitly.
