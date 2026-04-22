#!/usr/bin/env bash
# dev.sh — one-shot local dev bring-up for SES.
#
# What it does, in order:
#   1. Frees the dev ports (3210 web, 3211 API) — same trick as `npm run predev`.
#   2. Makes sure the local Postgres + Redis containers are up and healthy.
#   3. Runs `prisma generate` (so the client matches the schema).
#   4. Applies any pending migrations (`prisma migrate deploy`).
#   5. Seeds the DB (`prisma db seed` — idempotent, safe to re-run).
#   6. Starts the API + web dev servers via the existing `npm run dev`.
#
# Usage:
#   ./dev.sh           # full bring-up (default)
#   ./dev.sh stop      # kill dev servers + stop docker containers
#   ./dev.sh reset     # wipe DB volume, re-apply migrations, re-seed, start dev
#   ./dev.sh db        # only (re)apply migrations + seed, don't start the app
#   ./dev.sh doctor    # sanity-check the local dev prerequisites
#   ./dev.sh help      # print this help
#
# Re-run it anytime — every step is idempotent. Works on Linux and macOS.

set -Eeuo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SELF_DIR"

if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_DIM=''; C_RESET=''
fi

log()  { printf '%s==>%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s!!%s  %s\n'  "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%sxx%s  %s\n'  "$C_RED" "$C_RESET" "$*" >&2; exit 1; }
step() { printf '%s  %s%s\n'    "$C_DIM" "$*" "$C_RESET"; }

# ---- helpers ---------------------------------------------------------------

# Cross-platform port killer. Some boxes have `fuser` (Linux-only), the rest
# have `lsof`. We prefer fuser because it's quieter but fall back cleanly so
# macOS, WSL, and minimal container hosts all work.
kill_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  elif command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti tcp:"${port}" 2>/dev/null || true)"
    [[ -n "$pids" ]] && kill -9 $pids >/dev/null 2>&1 || true
  fi
}

# Compose v2 (`docker compose`) is preferred but we fall back to v1
# (`docker-compose`) so old dev boxes still work.
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    die "Neither 'docker compose' nor 'docker-compose' is available."
  fi
}

load_env() {
  if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
      warn ".env not found — copying .env.example to .env so defaults work."
      cp .env.example .env
    else
      die ".env not found and no .env.example to copy from."
    fi
  fi
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing dependency: $1"
}

# Node ≥ 20.19 is enforced in root package.json — check early so users get a
# clearer message than a hard-to-read engine mismatch at install time.
require_node() {
  require_cmd node
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if (( major < 20 )); then
    die "Node.js ${major} is too old — SES needs Node ≥ 20.19 (22 LTS recommended)."
  fi
}

free_dev_ports() {
  log "Freeing dev ports 3210 (web) and 3211 (API)"
  kill_port 3210
  kill_port 3211
  sleep 1
}

ensure_docker_services() {
  log "Ensuring Postgres + Redis containers are running"
  compose up -d postgres redis >/dev/null

  step "Waiting for Postgres to be healthy…"
  local attempts=0
  until compose exec -T postgres pg_isready -U ses -d ses >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if (( attempts > 30 )); then
      die "Postgres did not become healthy in 30s. Check: $(basename "$0") logs, or compose logs postgres"
    fi
    sleep 1
  done
  step "Postgres is ready."
}

prisma() {
  (cd apps/api && npx prisma "$@" --schema prisma/schema.prisma)
}

prisma_generate() {
  log "Generating Prisma client"
  prisma generate >/dev/null
}

prisma_migrate() {
  log "Applying pending migrations (prisma migrate deploy)"
  prisma migrate deploy
}

prisma_seed() {
  log "Seeding database (idempotent)"
  (cd apps/api && npm run --silent prisma:seed)
}

build_domain() {
  log "Building @ses/domain (shared package) once before dev"
  npm run --silent build --workspace @ses/domain
}

start_dev_servers() {
  log "Starting web (3210) + API (3211) — Ctrl+C to stop"
  exec npm run dev
}

reset_database() {
  warn "This will WIPE the local Postgres volume (ses_pg_data). All local data will be lost."
  read -r -p "Type 'yes' to continue: " confirm
  [[ "$confirm" == "yes" ]] || die "Aborted."
  log "Stopping containers and removing the DB volume"
  compose down -v >/dev/null
}

stop_all() {
  log "Stopping dev servers (ports 3210 web / 3211 API)"
  kill_port 3210
  kill_port 3211
  log "Stopping Postgres + Redis containers"
  compose down >/dev/null
  log "Done."
}

cmd_doctor() {
  local problems=0
  log "Checking local dev prerequisites…"

  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if (( major < 20 )); then
      warn "node $(node -v) (need ≥ 20.19)"; problems=$((problems + 1))
    else
      step "node $(node -v)"
    fi
  else
    warn "node: missing"; problems=$((problems + 1))
  fi

  if command -v npm >/dev/null 2>&1; then
    step "npm $(npm -v)"
  else
    warn "npm: missing"; problems=$((problems + 1))
  fi

  if command -v docker >/dev/null 2>&1; then
    step "docker $(docker --version)"
  else
    warn "docker: missing"; problems=$((problems + 1))
  fi

  if docker compose version >/dev/null 2>&1; then
    step "docker compose: $(docker compose version | head -1)"
  elif command -v docker-compose >/dev/null 2>&1; then
    step "docker-compose (v1): $(docker-compose --version)"
  else
    warn "docker compose: missing"; problems=$((problems + 1))
  fi

  if command -v fuser >/dev/null 2>&1 || command -v lsof >/dev/null 2>&1; then
    step "port killer: $(command -v fuser || command -v lsof)"
  else
    warn "neither fuser nor lsof available — stop/free commands will be no-ops"
  fi

  [[ -f .env ]] && step "root .env present" || warn "root .env missing (will be created from .env.example on first run)"

  if (( problems > 0 )); then
    die "$problems blocker(s). Install the missing tooling and try again."
  fi
  log "All checks passed."
}

cmd="${1:-up}"
case "$cmd" in
  up|'')
    require_node
    require_cmd npm
    require_cmd docker
    load_env
    free_dev_ports
    ensure_docker_services
    prisma_generate
    prisma_migrate
    prisma_seed
    build_domain
    start_dev_servers
    ;;
  reset)
    require_node
    require_cmd npm
    require_cmd docker
    load_env
    reset_database
    free_dev_ports
    ensure_docker_services
    prisma_generate
    prisma_migrate
    prisma_seed
    build_domain
    start_dev_servers
    ;;
  db)
    require_node
    require_cmd npm
    require_cmd docker
    load_env
    ensure_docker_services
    prisma_generate
    prisma_migrate
    prisma_seed
    log "DB is ready. Run './dev.sh' (or 'npm run dev') to start the app."
    ;;
  stop)
    require_cmd docker
    stop_all
    ;;
  doctor)
    cmd_doctor
    ;;
  help|-h|--help)
    awk 'NR>1 { if (/^#/) { sub(/^# ?/, ""); print } else { exit } }' "$0"
    ;;
  *)
    die "Unknown command: $cmd. Try: up | db | reset | stop | doctor | help"
    ;;
esac
