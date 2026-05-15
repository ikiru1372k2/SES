#!/usr/bin/env bash
# Refuse to start the dev stack while the prod stack is running.
#
# Dev (docker-compose.yml, project "ses-dev") and prod
# (docker-compose.prod.yml, project "ses") publish overlapping host ports
# (5432, 9000, …). Running both at once means whichever starts second fails
# on a port bind. This guard turns that into an early, explanatory abort so
# nobody is left wondering why the prod stack "went down".
set -Eeuo pipefail

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^ses-(postgres|api|web|ollama)-prod$'; then
  cat >&2 <<'MSG'
[guard] The PRODUCTION stack is currently running.

Starting the dev stack would collide with prod on shared host ports and
can knock the production containers offline.

Do one of the following:
  • Use the prod stack you already have:   open http://localhost:3210
  • Or stop prod first, then start dev:     ./deploy.sh stop && npm run docker:up

Aborting dev `docker compose up`.
MSG
  exit 1
fi
exit 0
