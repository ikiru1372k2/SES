#!/usr/bin/env bash
# aipilot.sh — one-shot bring-up for AI Pilot end-to-end on this VM.
#
# What it does:
#   1. Verifies prerequisites (Ollama running, qwen2.5:7b pulled, ~/ses-ai-test exists).
#   2. Starts the FastAPI service at :8000 if it isn't already running.
#   3. Runs Prisma migrations + seed against the SES Postgres DB.
#   4. (Optional with `reset`) wipes the SES database first — destructive.
#   5. Starts API + web dev servers (delegates to dev.sh which already handles ports).
#
# Usage:
#   ./aipilot.sh              # bring everything up (idempotent)
#   ./aipilot.sh reset        # DROP + recreate ses DB, then bring up (DESTRUCTIVE — prompts for confirmation)
#   ./aipilot.sh db           # only run migrations + seed, don't start servers
#   ./aipilot.sh ai           # only start (or restart) the FastAPI AI service
#   ./aipilot.sh stop         # stop FastAPI + dev servers
#   ./aipilot.sh status       # show what's running
#   ./aipilot.sh smoke        # run the FastAPI end-to-end smoke test
#   ./aipilot.sh help

set -Eeuo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SELF_DIR"

# Load .env so Prisma sees DATABASE_URL, AI_SERVICE_URL, etc.
# `set -a` exports every var that gets defined while it's on.
if [[ -f "$SELF_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SELF_DIR/.env"
  set +a
fi

AI_DIR="${AI_DIR:-$HOME/ses-ai-test}"
AI_URL="${AI_SERVICE_URL:-http://localhost:8000}"
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
MODEL="${AI_MODEL:-qwen2.5:7b}"
DB_NAME="${PGDATABASE:-ses}"
DB_USER="${PGUSER:-ses}"
DB_PASS="${PGPASSWORD:-ses}"
DB_HOST="${PGHOST:-127.0.0.1}"

if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_DIM=''; C_BOLD=''; C_RESET=''
fi

log()  { printf '%s\n' "${C_DIM}[$(date +%H:%M:%S)]${C_RESET} $*"; }
ok()   { printf '%s ✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s ⚠%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
err()  { printf '%s ✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
hdr()  { printf '\n%s── %s ──%s\n' "$C_BOLD" "$*" "$C_RESET"; }

# ── Prerequisites ─────────────────────────────────────────────────────────────

check_ollama() {
  if ! command -v ollama >/dev/null 2>&1; then
    err "ollama not found in PATH. Install from https://ollama.ai"
    return 1
  fi
  if ! curl -sf "$OLLAMA_URL" >/dev/null 2>&1; then
    warn "Ollama not responding at $OLLAMA_URL. Trying to start it via systemd..."
    sudo systemctl start ollama 2>/dev/null || true
    sleep 2
    if ! curl -sf "$OLLAMA_URL" >/dev/null 2>&1; then
      err "Ollama still not running. Start it manually: sudo systemctl start ollama"
      return 1
    fi
  fi
  if ! ollama list 2>/dev/null | grep -q "$MODEL"; then
    err "Model $MODEL not pulled. Run: ollama pull $MODEL"
    return 1
  fi
  ok "Ollama ready (model: $MODEL)"
}

check_ai_dir() {
  if [[ ! -d "$AI_DIR/venv" ]]; then
    err "$AI_DIR/venv not found. Set up the venv per docs/ai-pilot.md."
    return 1
  fi
  if [[ ! -f "$AI_DIR/main.py" ]]; then
    err "$AI_DIR/main.py missing. Drop the FastAPI files in (see docs/ai-pilot.md)."
    return 1
  fi
  if [[ ! -x "$AI_DIR/start-ai.sh" ]]; then
    err "$AI_DIR/start-ai.sh missing or not executable."
    return 1
  fi
  ok "FastAPI service files present"
}

check_db() {
  if ! PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d postgres -c "SELECT 1" >/dev/null 2>&1; then
    err "Cannot connect to Postgres at $DB_HOST as $DB_USER. Is docker compose up?"
    return 1
  fi
  ok "Postgres reachable"
}

# Remove orphan prod containers (ses-api-1, ses-web-1, ses-migrate-1) that
# squat on dev ports 3210/3211 if you've ever run docker-compose.prod.yml.
# Safe to run repeatedly.
clear_orphan_containers() {
  local orphans
  orphans=$(docker ps -a --format '{{.Names}}' 2>/dev/null \
    | grep -E '^(ses-api-1|ses-web-1|ses-migrate-1)$' || true)
  if [[ -n "$orphans" ]]; then
    log "Removing orphan compose containers holding dev ports..."
    echo "$orphans" | xargs -r docker rm -f >/dev/null 2>&1 || true
    ok "Orphan containers cleared"
  fi
}

# ── FastAPI service control ──────────────────────────────────────────────────

ai_running() {
  curl -sf "$AI_URL/health" >/dev/null 2>&1
}

start_ai() {
  if ai_running; then
    ok "FastAPI already running at $AI_URL"
    return 0
  fi
  log "Starting FastAPI service..."
  ( cd "$AI_DIR" && ./start-ai.sh )
  if ai_running; then
    ok "FastAPI live at $AI_URL"
  else
    err "FastAPI failed to come up. tail -50 $AI_DIR/ai-service.log"
    return 1
  fi
}

stop_ai() {
  if [[ -x "$AI_DIR/stop-ai.sh" ]]; then
    ( cd "$AI_DIR" && ./stop-ai.sh ) || true
  fi
  ok "FastAPI stopped"
}

smoke_ai() {
  if [[ -x "$AI_DIR/smoke-test.sh" ]]; then
    ( cd "$AI_DIR" && ./smoke-test.sh )
  else
    err "$AI_DIR/smoke-test.sh missing"
    return 1
  fi
}

# ── Database operations ──────────────────────────────────────────────────────

reset_db() {
  hdr "Resetting database $DB_NAME"
  printf '%sThis will %sDROP%s the entire %s%s%s database. All users/processes/files/audits will be lost.%s\n' \
    "$C_RED" "$C_BOLD" "$C_RESET$C_RED" "$C_BOLD" "$DB_NAME" "$C_RESET$C_RED" "$C_RESET"
  read -rp "Type 'yes' to confirm: " confirm
  if [[ "$confirm" != "yes" ]]; then
    err "Aborted."
    return 1
  fi
  log "Terminating active connections..."
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME' AND pid<>pg_backend_pid();" >/dev/null
  log "Dropping $DB_NAME..."
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" >/dev/null
  log "Recreating $DB_NAME..."
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" >/dev/null
  ok "Database $DB_NAME wiped and recreated"
}

migrate_and_seed() {
  hdr "Prisma: generate, migrate, seed"
  cd "$SELF_DIR/apps/api"
  npx prisma generate
  npx prisma migrate deploy
  if grep -q '"prisma:seed"' package.json; then
    npm run prisma:seed
  else
    warn "No prisma:seed script in apps/api/package.json — skipping seed"
  fi
  cd "$SELF_DIR"
  ok "Database is in sync"
}

# ── Dev servers (delegate to existing dev.sh) ────────────────────────────────

start_dev_servers() {
  hdr "Starting SES dev servers (delegating to ./dev.sh)"
  if [[ ! -x "$SELF_DIR/dev.sh" ]]; then
    err "dev.sh not found in $SELF_DIR"
    return 1
  fi
  exec "$SELF_DIR/dev.sh"
}

# ── Status / help ────────────────────────────────────────────────────────────

show_status() {
  hdr "Status"
  if curl -sf "$OLLAMA_URL" >/dev/null 2>&1; then ok "Ollama @ $OLLAMA_URL"; else warn "Ollama down"; fi
  if ai_running; then ok "FastAPI @ $AI_URL"; else warn "FastAPI down"; fi
  if PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
    local rule_count
    rule_count=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT count(*) FROM \"AuditRule\" WHERE source='ai-pilot';" 2>/dev/null || echo "?")
    ok "Postgres @ $DB_NAME — AI Pilot rules: $rule_count"
  else
    warn "Postgres unreachable"
  fi
  if curl -sf "http://localhost:3211/api/v1/health" >/dev/null 2>&1; then ok "SES API @ :3211"; else warn "SES API down"; fi
  if curl -sf "http://localhost:3210" >/dev/null 2>&1; then ok "SES Web @ :3210"; else warn "SES Web down"; fi
}

show_help() {
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
}

# ── Main dispatcher ──────────────────────────────────────────────────────────

cmd="${1:-up}"

case "$cmd" in
  up|"")
    check_ollama
    check_ai_dir
    check_db
    clear_orphan_containers
    start_ai
    migrate_and_seed
    start_dev_servers
    ;;
  reset)
    check_db
    clear_orphan_containers
    reset_db
    check_ollama
    check_ai_dir
    start_ai
    migrate_and_seed
    start_dev_servers
    ;;
  db)
    check_db
    migrate_and_seed
    ;;
  ai)
    check_ollama
    check_ai_dir
    stop_ai
    start_ai
    ;;
  stop)
    stop_ai
    if [[ -x "$SELF_DIR/dev.sh" ]]; then "$SELF_DIR/dev.sh" stop || true; fi
    ;;
  status)
    show_status
    ;;
  smoke)
    check_ollama
    start_ai
    smoke_ai
    ;;
  help|-h|--help)
    show_help
    ;;
  *)
    err "Unknown command: $cmd"
    show_help
    exit 1
    ;;
esac
