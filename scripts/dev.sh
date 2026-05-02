#!/usr/bin/env bash
# scripts/dev.sh — local-stack lifecycle for SES.
#
# Manages: PostgreSQL, MinIO (S3-compatible), AI sidecar, API, web app.
# All services run from the repo's docker-compose.yml plus host processes
# (npm dev servers + AI sidecar). Operations are idempotent and safe to
# re-run.
#
# See `./scripts/dev.sh help` for the command list.

set -Eeuo pipefail

# -------- repo root resolution -----------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PROJECT_NAME="ses"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"
LOG_DIR="$REPO_ROOT/.logs"
mkdir -p "$LOG_DIR"

API_PORT=3211
WEB_PORT=3210
AI_PORT=8000
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001
DB_PORT=5432

# -------- pretty print --------------------------------------------------------

if [ -t 1 ]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_BLUE=''; C_DIM=''; C_BOLD=''; C_RESET=''
fi

log()    { printf '%s==>%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn()   { printf '%s !!%s  %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()    { printf '%s xx%s  %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
die()    { err "$*"; exit 1; }
step()   { printf '    %s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }
section(){ printf '\n%s── %s ──%s\n' "$C_BOLD" "$*" "$C_RESET"; }

# -------- prerequisite checks ------------------------------------------------

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1 ($2)"
}

check_prereqs() {
  require_cmd docker "install Docker Engine; see https://docs.docker.com/engine/install/"
  if ! docker compose version >/dev/null 2>&1; then
    die "'docker compose' subcommand not available; install Docker Compose v2"
  fi
  require_cmd node  "install Node ≥ 20.19; nvm or direct download"
  require_cmd npm   "install npm (ships with Node)"
  require_cmd curl  "install curl"
  [ -f "$COMPOSE_FILE" ] || die "compose file not found at $COMPOSE_FILE"
}

# -------- env loading --------------------------------------------------------

load_env() {
  local f
  for f in .env .env.local; do
    if [ -f "$REPO_ROOT/$f" ]; then
      set -a
      # shellcheck disable=SC1090
      . "$REPO_ROOT/$f"
      set +a
    fi
  done
  if [ ! -f "$REPO_ROOT/.env" ] && [ -f "$REPO_ROOT/.env.example" ]; then
    warn ".env not found — copying from .env.example so defaults work"
    cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
    set -a
    # shellcheck disable=SC1091
    . "$REPO_ROOT/.env"
    set +a
  fi
  : "${DATABASE_URL:=postgresql://ses:ses@127.0.0.1:${DB_PORT}/ses}"
  : "${OBJECT_STORAGE_ENDPOINT:=http://localhost:${MINIO_PORT}}"
  : "${OBJECT_STORAGE_BUCKET:=ses-ai-files}"
  : "${OBJECT_STORAGE_ACCESS_KEY:=minioadmin}"
  : "${OBJECT_STORAGE_SECRET_KEY:=minioadmin}"
  : "${AI_SERVICE_URL:=http://localhost:${AI_PORT}}"
  : "${AI_DIR:=$HOME/ses-ai-test}"
  : "${AI_PILOT_TRANSPORT:=http}"
  export DATABASE_URL OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_BUCKET
  export OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY
  export AI_SERVICE_URL AI_DIR AI_PILOT_TRANSPORT
}

dc() { docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" "$@"; }

# -------- helpers -------------------------------------------------------------

is_port_open() {
  (echo > "/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

kill_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  elif command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti tcp:"${port}" 2>/dev/null || true)"
    [ -n "$pids" ] && kill -9 "$pids" >/dev/null 2>&1 || true
  fi
}

wait_url() {
  local url="$1" tries="${2:-30}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

wait_pg() {
  for _ in $(seq 1 30); do
    if dc exec -T postgres pg_isready -U ses -d ses >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

confirm() {
  local prompt="$1" expected="$2" answer
  printf '%s%s%s ' "$C_YELLOW" "$prompt" "$C_RESET"
  read -r answer
  [ "$answer" = "$expected" ]
}

# -------- service lifecycle: docker ------------------------------------------

stop_orphan_containers() {
  # Old `ses-api-1` / `ses-web-1` containers from docker-compose.demo.yml
  # or .prod.yml hold ports 3210/3211 and cause the host API + Vite to
  # silently fail to bind. Stop and remove them up front.
  local stale
  stale="$(docker ps --format '{{.Names}}' 2>/dev/null \
    | grep -E '^ses-(api|web|migrate)-[0-9]+$' || true)"
  if [ -n "$stale" ]; then
    step "stopping orphan containers: $(echo $stale | tr '\n' ' ')"
    echo "$stale" | xargs -r docker stop >/dev/null 2>&1 || true
    echo "$stale" | xargs -r docker rm   >/dev/null 2>&1 || true
  fi
}

start_docker_services() {
  section "starting docker services"
  stop_orphan_containers
  step "postgres + redis + minio"
  dc up -d postgres redis minio
  step "waiting for Postgres"
  wait_pg || die "Postgres did not become healthy"
  step "waiting for MinIO"
  wait_url "${OBJECT_STORAGE_ENDPOINT%/}/minio/health/live" 30 || die "MinIO did not become healthy"
  step "ensuring bucket '${OBJECT_STORAGE_BUCKET}' (idempotent)"
  dc run --rm minio-init >/dev/null
}

# -------- migrations + seed --------------------------------------------------

run_migrations() {
  section "applying SQL migrations (no Prisma)"
  npm run --silent --workspace @ses/api db:migrate
}

run_seed() {
  section "seeding reference data (idempotent)"
  npm run --silent --workspace @ses/api db:seed || warn "seed reported a problem; continuing"
}

# -------- AI sidecar ---------------------------------------------------------

ai_running() { curl -sf "$AI_SERVICE_URL/health" >/dev/null 2>&1; }

start_ai() {
  section "AI sidecar"
  if ai_running; then
    log "already running at $AI_SERVICE_URL"
    return 0
  fi
  if [ ! -d "$AI_DIR" ]; then
    warn "AI sidecar dir '$AI_DIR' not found — set AI_DIR or install the sidecar"
    warn "  expected layout: \$AI_DIR/{venv,main.py} (or an executable start.sh)"
    warn "  start manually: cd \$AI_DIR && uvicorn main:app --host 0.0.0.0 --port ${AI_PORT}"
    return 0
  fi
  if [ ! -x "$AI_DIR/start.sh" ] && [ ! -f "$AI_DIR/main.py" ]; then
    warn "no start.sh or main.py in $AI_DIR — skipping AI sidecar"
    return 0
  fi
  log "starting from $AI_DIR (logs → $LOG_DIR/ai.log)"
  ( cd "$AI_DIR" && nohup bash -c '
      set -a; [ -f .env ] && . .env; set +a
      if [ -x ./start.sh ]; then ./start.sh
      elif [ -d venv ]; then . venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port '"$AI_PORT"'
      else uvicorn main:app --host 0.0.0.0 --port '"$AI_PORT"'
      fi
    ' >"$LOG_DIR/ai.log" 2>&1 & echo $! >"$LOG_DIR/ai.pid" )
  if wait_url "$AI_SERVICE_URL/health" 30; then
    log "healthy at $AI_SERVICE_URL"
  else
    warn "did not become healthy in 30s — see $LOG_DIR/ai.log"
  fi
}

stop_ai() {
  if [ -f "$LOG_DIR/ai.pid" ]; then
    local pid
    pid="$(cat "$LOG_DIR/ai.pid" 2>/dev/null || true)"
    if [ -n "${pid:-}" ]; then
      kill "$pid" 2>/dev/null || true
      rm -f "$LOG_DIR/ai.pid"
    fi
  fi
  kill_port "$AI_PORT"
}

# -------- API + web (host processes) ----------------------------------------

start_api_and_web() {
  section "starting API ($API_PORT) and web ($WEB_PORT)"
  step "freeing ports"
  kill_port "$WEB_PORT"
  kill_port "$API_PORT"
  log "logs → $LOG_DIR/api.log and $LOG_DIR/web.log"
  ( nohup bash -c 'npm run dev:api' >"$LOG_DIR/api.log" 2>&1 & echo $! >"$LOG_DIR/api.pid" )
  ( nohup bash -c 'npm run dev:web' >"$LOG_DIR/web.log" 2>&1 & echo $! >"$LOG_DIR/web.pid" )
  step "waiting for API health"
  wait_url "http://127.0.0.1:${API_PORT}/api/v1/health" 60 \
    || warn "API did not respond in 60s — check $LOG_DIR/api.log"
  step "waiting for web"
  wait_url "http://127.0.0.1:${WEB_PORT}" 60 \
    || warn "web did not respond in 60s — check $LOG_DIR/web.log"
}

stop_api_and_web() {
  for name in api web; do
    if [ -f "$LOG_DIR/${name}.pid" ]; then
      local pid
      pid="$(cat "$LOG_DIR/${name}.pid" 2>/dev/null || true)"
      if [ -n "${pid:-}" ]; then
        kill "$pid" 2>/dev/null || true
        rm -f "$LOG_DIR/${name}.pid"
      fi
    fi
  done
  kill_port "$WEB_PORT"
  kill_port "$API_PORT"
}

# -------- subcommands --------------------------------------------------------

cmd_start() {
  check_prereqs
  load_env
  start_docker_services
  run_migrations
  run_seed
  start_ai
  start_api_and_web
  cmd_status
  section "URLs"
  printf '  web:        http://127.0.0.1:%s\n' "$WEB_PORT"
  printf '  api:        http://127.0.0.1:%s/api/v1\n' "$API_PORT"
  printf '  ai sidecar: %s    (transport=%s)\n' "$AI_SERVICE_URL" "$AI_PILOT_TRANSPORT"
  printf '  minio s3:   %s\n' "$OBJECT_STORAGE_ENDPOINT"
  printf '  minio ui:   http://127.0.0.1:%s    (login: %s / [secret hidden])\n' \
    "$MINIO_CONSOLE_PORT" "$OBJECT_STORAGE_ACCESS_KEY"
  printf '  postgres:   postgresql://ses:***@127.0.0.1:%s/ses\n' "$DB_PORT"
  if [ "${AI_PILOT_TRANSPORT:-http}" = "grpc" ]; then
    printf '  ai grpc:    %s\n' "${AI_SERVICE_GRPC_URL:-localhost:50051}"
  fi
}

cmd_stop() {
  check_prereqs
  load_env
  section "stopping host processes"
  stop_api_and_web
  stop_ai
  section "stopping docker services"
  dc stop postgres redis minio || true
  log "stopped"
}

cmd_restart() {
  cmd_stop
  cmd_start
}

cmd_status() {
  check_prereqs
  load_env
  section "ports"
  for spec in "$DB_PORT:postgres" "$MINIO_PORT:minio-s3" "$MINIO_CONSOLE_PORT:minio-ui" \
              "$AI_PORT:ai-sidecar" "$API_PORT:api" "$WEB_PORT:web"; do
    local port name
    port="${spec%%:*}"; name="${spec#*:}"
    if is_port_open "$port"; then
      printf '  %-12s :%-5s %sopen%s\n' "$name" "$port" "$C_GREEN" "$C_RESET"
    else
      printf '  %-12s :%-5s %sclosed%s\n' "$name" "$port" "$C_DIM" "$C_RESET"
    fi
  done

  section "health"
  if curl -sf "http://127.0.0.1:${API_PORT}/api/v1/health" >/dev/null 2>&1; then
    printf '  api:    %sok%s\n' "$C_GREEN" "$C_RESET"
  else
    printf '  api:    %sdown%s\n' "$C_RED" "$C_RESET"
  fi
  if curl -sf "${OBJECT_STORAGE_ENDPOINT%/}/minio/health/live" >/dev/null 2>&1; then
    printf '  minio:  %sok%s\n' "$C_GREEN" "$C_RESET"
  else
    printf '  minio:  %sdown%s\n' "$C_RED" "$C_RESET"
  fi
  if dc exec -T postgres pg_isready -U ses -d ses >/dev/null 2>&1; then
    printf '  pg:     %sok%s\n' "$C_GREEN" "$C_RESET"
  else
    printf '  pg:     %sdown%s\n' "$C_RED" "$C_RESET"
  fi
  if ai_running; then
    printf '  ai:     %sok%s  (%s)\n' "$C_GREEN" "$C_RESET" "$AI_SERVICE_URL"
  else
    printf '  ai:     %sdown%s\n' "$C_DIM" "$C_RESET"
  fi
}

cmd_logs() {
  check_prereqs
  load_env
  local target="${1:-all}"
  case "$target" in
    api)   tail -F "$LOG_DIR/api.log" ;;
    web)   tail -F "$LOG_DIR/web.log" ;;
    ai)    tail -F "$LOG_DIR/ai.log" ;;
    db)    dc logs -f postgres ;;
    minio) dc logs -f minio ;;
    redis) dc logs -f redis ;;
    all|"") tail -F "$LOG_DIR"/*.log 2>/dev/null & local tail_pid=$!
            trap 'kill $tail_pid 2>/dev/null || true' INT TERM
            dc logs -f postgres minio redis
            kill "$tail_pid" 2>/dev/null || true ;;
    *)     die "unknown logs target: $target (try: api, web, ai, db, minio, redis, all)" ;;
  esac
}

cmd_reset() {
  check_prereqs
  load_env
  section "reset — local services + DB schema"
  cat <<'EOF'
This will:
  • stop API, web, AI, and docker services
  • remove the LOCAL Postgres volume (ses_pg_data) and MinIO volume (ses_minio_data)
  • reapply SQL migrations and recreate the bucket
This does NOT remove source files, .git, or anything outside docker-compose volumes.
EOF
  confirm "type RESET to proceed:" "RESET" || die "aborted"
  cmd_stop
  section "removing local volumes"
  dc down -v
  cmd_start
}

cmd_erase() {
  check_prereqs
  load_env
  section "erase — DESTRUCTIVE local cleanup"
  printf '%sThis will remove:%s\n' "$C_RED" "$C_RESET"
  printf '  • all docker containers, networks, and volumes for project "%s"\n' "$PROJECT_NAME"
  printf '  • the .logs/ directory inside the repo\n'
  printf '  • the .env file is left in place\n'
  printf '%sNothing outside this repo is touched. .git is preserved.%s\n' "$C_DIM" "$C_RESET"
  confirm 'type "I understand this deletes local data" to proceed:' \
          "I understand this deletes local data" \
          || die "aborted"
  cmd_stop
  section "tearing down docker resources"
  dc down -v --remove-orphans || true
  section "removing project-owned local logs"
  if [ -d "$LOG_DIR" ]; then
    case "$LOG_DIR" in
      "$REPO_ROOT/.logs")
        rm -rf "$LOG_DIR"
        log "removed $LOG_DIR"
        ;;
      *)
        warn "refused to remove unexpected log dir: $LOG_DIR"
        ;;
    esac
  fi
  log "erase complete"
}

cmd_help() {
  cat <<EOF
${C_BOLD}scripts/dev.sh${C_RESET} — local stack lifecycle

${C_BOLD}USAGE${C_RESET}
  ./scripts/dev.sh <command> [args]

${C_BOLD}COMMANDS${C_RESET}
  start       bring up docker services + run migrations + start AI/API/web
  stop        stop everything cleanly
  restart     stop then start
  status      show port + health for each service
  logs [t]    stream logs; t ∈ api|web|ai|db|minio|redis|all (default all)
  reset       stop + drop local DB and MinIO volumes, then start fresh
              (asks for typed confirmation)
  erase       remove all project-owned docker resources + local logs
              (requires literal: "I understand this deletes local data")
  help        this message

${C_BOLD}EXAMPLES${C_RESET}
  ./scripts/dev.sh start
  ./scripts/dev.sh status
  ./scripts/dev.sh logs api
  ./scripts/dev.sh stop
  ./scripts/dev.sh reset
  ./scripts/dev.sh erase

${C_BOLD}ENV${C_RESET}
  Reads .env (and .env.local if present) from the repo root. The script
  copies .env.example → .env on first run if .env is missing.
  Object storage selection is env-only (MinIO locally; AWS S3 in prod —
  see README "Object Storage" section).
EOF
}

# -------- dispatch -----------------------------------------------------------

main() {
  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    start)   cmd_start "$@" ;;
    stop)    cmd_stop "$@" ;;
    restart) cmd_restart "$@" ;;
    status)  cmd_status "$@" ;;
    logs)    cmd_logs "$@" ;;
    reset)   cmd_reset "$@" ;;
    erase)   cmd_erase "$@" ;;
    help|-h|--help) cmd_help ;;
    *) err "unknown command: $cmd"; cmd_help; exit 2 ;;
  esac
}

main "$@"
