# SQL Migrations

Hand-written SQL is the source of truth for the database schema. Prisma
is **not** authoritative; the `apps/api/prisma/` directory is retained
only as a parity reference until Phase D deletion (see the project plan
under "Production Data Migration").

## Conventions

- Files are `NNNN_short_description.sql`, monotonically increasing.
- Each file runs in a single transaction with `pg_advisory_xact_lock`
  held — see `apps/api/db/runner.ts`.
- A migration must include a header comment block describing intent
  and a manual rollback recipe.
- The migrator skips already-applied versions, recorded in
  `_schema_migrations`.

## Running

```bash
# fresh DB (dev / CI)
DATABASE_URL=postgres://... npm run db:migrate --workspace @ses/api

# preview pending without applying
DATABASE_URL=postgres://... npm run db:migrate:dryrun --workspace @ses/api

# mark every on-disk migration as already-applied (one-shot, prod-only)
DATABASE_URL=postgres://... npm run db:baseline --workspace @ses/api
```

## Production data migration

Existing prod databases already have all `0001_*` content applied (via
the original Prisma migrations). Run `db:baseline` once before deploying
the new binary so the runner skips `0001_init.sql` instead of failing on
duplicate `CREATE TABLE`s. Forward-only migrations (`0002_*` and later)
then apply normally.

## Authority

These SQL files are the schema authority. There is no separate
ORM-managed history to compare against; new schema changes land here.
