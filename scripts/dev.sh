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
  # The AI sidecar now lives in-repo at services/ai-sidecar/. Falls back to
  # the legacy ~/ses-ai-test/ location if the new one isn't there yet.
  if [[ -z "${AI_DIR:-}" ]]; then
    if [[ -d "$REPO_ROOT/services/ai-sidecar" ]]; then
      AI_DIR="$REPO_ROOT/services/ai-sidecar"
    else
      AI_DIR="$HOME/ses-ai-test"
    fi
  fi
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

# Liveness only (public path). NOTE: a foreign/squatter sidecar also answers
# /health, so this must NOT be used to decide "skip start" — see start_ai.
ai_running() { curl -sf "$AI_SERVICE_URL/health" >/dev/null 2>&1; }

# Readiness: is THIS repo's sidecar up AND does the shared-secret handshake
# work? `/analytics/chat` is auth-gated and fails closed (503) when the
# sidecar has no SIDECAR_SHARED_SECRET — which is exactly the squatter
# failure mode. We don't need a model answer, just to get past the auth
# middleware, so a 503 ("auth not configured") => NOT ready; anything else
# (200/400/streaming) => the secret matches and the sidecar is ours.
ai_authed() {
  local body
  body="$(curl -s --max-time 5 -o - -X POST "$AI_SERVICE_URL/analytics/chat" \
    -H 'Content-Type: application/json' \
    -H "X-Internal-Token: ${SIDECAR_SHARED_SECRET:-}" \
    -d '{"process_code":"_probe","question":"_probe","rows":[],"use_stub":true}' 2>/dev/null || true)"
  case "$body" in
    *"auth not configured"*|*"Unauthorized"*|"") return 1 ;;
    *) return 0 ;;
  esac
}

start_ai() {
  section "AI sidecar"
  # User policy: dev.sh always owns a correctly-configured sidecar on
  # :$AI_PORT. If something is already there and the authed handshake works,
  # keep it; otherwise (foreign squatter / no secret / down) take over the
  # port and start THIS repo's sidecar with the repo-root .env secret.
  if ai_running && ai_authed; then
    log "correctly-configured sidecar already running at $AI_SERVICE_URL"
    return 0
  fi
  if ai_running; then
    warn "a sidecar on :$AI_PORT failed the shared-secret handshake — taking over the port"
  fi
  stop_ai
  kill_port "$AI_PORT"
  if [ ! -d "$AI_DIR" ]; then
    warn "AI sidecar dir '$AI_DIR' not found — set AI_DIR or install the sidecar"
    warn "  expected layout: \$AI_DIR/{venv,main.py} (or an executable start.sh)"
    warn "  start manually: cd \$AI_DIR && uvicorn main:app --host 0.0.0.0 --port ${AI_PORT}"
    return 0
  fi
  if [ ! -x "$AI_DIR/start.sh" ] && [ ! -x "$AI_DIR/start-ai.sh" ] && [ ! -f "$AI_DIR/main.py" ]; then
    warn "no start.sh / start-ai.sh / main.py in $AI_DIR — skipping AI sidecar"
    return 0
  fi
  # First-time bootstrap: in-repo sidecar ships without a venv.
  # If the legacy ~/ses-ai-test/venv exists (from prior sidecar), reuse it via
  # symlink — saves 5GB+ of duplicated wheels (docling alone is huge).
  if [ ! -d "$AI_DIR/venv" ]; then
    if [ -d "$HOME/ses-ai-test/venv" ]; then
      log "reusing existing venv from ~/ses-ai-test (symlink)"
      ln -s "$HOME/ses-ai-test/venv" "$AI_DIR/venv"
    elif command -v python3 >/dev/null 2>&1; then
      log "creating fresh venv at $AI_DIR/venv (first-run bootstrap, may take a few minutes)"
      ( cd "$AI_DIR" && python3 -m venv venv && \
          ./venv/bin/pip install -q -U pip && \
          ./venv/bin/pip install -q fastapi uvicorn python-multipart duckdb pandas openpyxl ollama pydantic docling ) \
        >>"$LOG_DIR/ai.log" 2>&1 || warn "venv bootstrap failed; check $LOG_DIR/ai.log"
    fi
  fi
  # Auth + model env for the sidecar process. load_env already sourced the
  # repo-root .env, so SIDECAR_SHARED_SECRET is in this shell's environment.
  # The sidecar's own dir has NO .env, so we must pass these through
  # explicitly — sourcing $AI_DIR/.env (the old behaviour) silently dropped
  # the secret and left the sidecar failing closed.
  if [ -z "${SIDECAR_SHARED_SECRET:-}" ]; then
    warn "SIDECAR_SHARED_SECRET is empty in repo-root .env — analytics/AI-pilot"
    warn "  will fail the sidecar auth handshake. Set it in $REPO_ROOT/.env"
    warn "  (see .env.example: a 32+ char random secret)."
  fi
  # Analytics agent = DeepSeek-R1 (user choice). AI Pilot keeps its earlier
  # models (AI_MODEL=qwen2.5:7b, AI_ENHANCE_MODEL=llama3:latest) — pass
  # whatever .env defines, falling back to the established defaults so a
  # bare .env still yields a working stack.
  local _agent_model _pilot_model _enhance_model _embed_model
  _agent_model="${AI_AGENT_MODEL:-deepseek-r1:8b}"
  _pilot_model="${AI_MODEL:-qwen2.5:7b}"
  _enhance_model="${AI_ENHANCE_MODEL:-llama3:latest}"
  _embed_model="${AI_EMBED_MODEL:-nomic-embed-text}"
  log "starting from $AI_DIR (agent=$_agent_model, pilot=$_pilot_model; logs → $LOG_DIR/ai.log)"
  # Analytics provider passthrough (analytics ONLY — AI Pilot always stays
  # on its local model). Default empty/ollama keeps the local-only posture;
  # set AI_ANALYTICS_PROVIDER=gemini + GEMINI_API_KEY in .env to opt in.
  if [ "${AI_ANALYTICS_PROVIDER:-ollama}" = "gemini" ] && [ -n "${GEMINI_API_KEY:-}" ]; then
    warn "analytics provider = GEMINI (cloud) — pseudonymized rows leave the host"
  fi
  ( cd "$AI_DIR" && SIDECAR_SHARED_SECRET="${SIDECAR_SHARED_SECRET:-}" \
      AI_AGENT_MODEL="$_agent_model" AI_MODEL="$_pilot_model" \
      AI_ENHANCE_MODEL="$_enhance_model" AI_EMBED_MODEL="$_embed_model" \
      AI_ANALYTICS_PROVIDER="${AI_ANALYTICS_PROVIDER:-ollama}" \
      GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
      AI_GEMINI_MODEL="${AI_GEMINI_MODEL:-gemini-2.0-flash}" \
      OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}" \
      nohup bash -c '
      if [ -x ./start-ai.sh ]; then ./start-ai.sh
      elif [ -x ./start.sh ]; then ./start.sh
      elif [ -d venv ]; then . venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port '"$AI_PORT"'
      else uvicorn main:app --host 0.0.0.0 --port '"$AI_PORT"'
      fi
    ' >"$LOG_DIR/ai.log" 2>&1 & echo $! >"$LOG_DIR/ai.pid" )
  if wait_url "$AI_SERVICE_URL/health" 30; then
    if ai_authed; then
      log "healthy + authed at $AI_SERVICE_URL"
    else
      warn "sidecar is up but the shared-secret handshake still fails —"
      warn "  check SIDECAR_SHARED_SECRET in $REPO_ROOT/.env, then: ./scripts/dev.sh restart"
    fi
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
  # start-ai.sh writes its OWN pidfile and refuses to start if it exists and
  # the PID is alive ("AI sidecar already running"). A stale one pointing at
  # a foreign/squatter process would block the takeover, so clear it too.
  if [ -n "${AI_DIR:-}" ] && [ -f "$AI_DIR/ai-service.pid" ]; then
    local spid
    spid="$(cat "$AI_DIR/ai-service.pid" 2>/dev/null || true)"
    [ -n "${spid:-}" ] && kill "$spid" 2>/dev/null || true
    rm -f "$AI_DIR/ai-service.pid"
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
  # Bind to 0.0.0.0 so both services are reachable from the LAN, not just
  # loopback. HOST controls the NestJS listen address; dev:lan passes
  # --host 0.0.0.0 to Vite. SES_CORS_ORIGINS broadens the CORS allowlist to
  # include requests from any local machine on the same subnet.
  ( nohup bash -c 'HOST=0.0.0.0 SES_CORS_ORIGINS="http://localhost:3210,http://127.0.0.1:3210,http://192.168.68.127:3210" npm run dev:api' >"$LOG_DIR/api.log" 2>&1 & echo $! >"$LOG_DIR/api.pid" )
  ( nohup bash -c 'npm run build --workspace @ses/domain && npm run dev:lan --workspace @ses/web' >"$LOG_DIR/web.log" 2>&1 & echo $! >"$LOG_DIR/web.pid" )
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
