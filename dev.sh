#!/usr/bin/env bash
# dev.sh — unified local dev helper for SES (includes AI Pilot support).
#
# Commands:
#   up          Full bring-up: docker services + migrations + seed + dev servers
#   down        Stop dev servers + docker containers
#   start       Start dev servers only (assumes docker already running)
#   stop        Alias for down
#   reset       Wipe DB volume, re-migrate, re-seed, then start dev
#   erase-db    Drop + recreate ses database in-place (no volume wipe) + re-migrate + seed
#   ai          Like 'up' but also starts the FastAPI AI Pilot service at :8000
#   status      Show what's running (docker, API, web, AI service)
#   logs        Tail docker compose logs (ctrl+c to exit)
#   migrate     Run prisma generate + migrate deploy (no server start)
#   seed        Run prisma seed only
#   install     npm install across workspace
#   help        Print this help
#
# AI Pilot prerequisites (only needed for 'ai' command):
#   - Ollama running locally: https://ollama.ai
#   - Model pulled: ollama pull qwen2.5:7b (or set AI_MODEL env)
#   - FastAPI service dir: ~/ses-ai-test with venv + main.py + start-ai.sh
#
# Environment:
#   AI_DIR      Path to FastAPI service dir (default: ~/ses-ai-test)
#   AI_MODEL    Ollama model name (default: qwen2.5:7b)
#   AI_SERVICE_URL  FastAPI base URL (default: http://localhost:8000)
#   OLLAMA_URL  Ollama API URL (default: http://localhost:11434)

set -Eeuo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SELF_DIR"

# ── Colours ───────────────────────────────────────────────────────────────────

if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
  C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_CYAN=$'\033[36m'; C_RESET=$'\033[0m'
else
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_DIM=''; C_BOLD=''; C_CYAN=''; C_RESET=''
fi

log()  { printf '%s==>%s %s\n'    "$C_GREEN"  "$C_RESET" "$*"; }
warn() { printf '%s!!%s  %s\n'    "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%sxx%s  %s\n'    "$C_RED"    "$C_RESET" "$*" >&2; exit 1; }
step() { printf '%s  %s%s\n'      "$C_DIM"    "$*" "$C_RESET"; }
hdr()  { printf '\n%s─── %s ──%s\n' "$C_BOLD" "$*" "$C_RESET"; }
ok()   { printf '%s  ✓%s %s\n'    "$C_CYAN"   "$C_RESET" "$*"; }

# ── Core helpers ──────────────────────────────────────────────────────────────

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
      warn ".env not found — copying .env.example → .env"
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

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing dependency: $1"; }

require_node() {
  require_cmd node
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  (( major >= 20 )) || die "Node.js ${major} is too old — SES needs Node ≥ 20.19"
}

# ── Docker services ───────────────────────────────────────────────────────────

ensure_docker_services() {
  log "Ensuring Postgres + Redis are running"
  compose up -d postgres redis >/dev/null
  step "Waiting for Postgres to be healthy…"
  local attempts=0
  until compose exec -T postgres pg_isready -U ses -d ses >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    (( attempts <= 30 )) || die "Postgres did not become healthy in 30s"
    sleep 1
  done
  ok "Postgres ready"
}

# ── Prisma ────────────────────────────────────────────────────────────────────

prisma_cmd() { (cd apps/api && npx prisma "$@" --schema prisma/schema.prisma); }

prisma_generate() {
  log "Generating Prisma client"
  prisma_cmd generate >/dev/null
}

prisma_migrate() {
  log "Applying pending migrations"
  prisma_cmd migrate deploy
}

prisma_seed() {
  log "Seeding database"
  (cd apps/api && npm run --silent prisma:seed)
}

build_domain() {
  log "Building @ses/domain"
  npm run --silent build --workspace @ses/domain
}

# ── Dev servers ───────────────────────────────────────────────────────────────

free_dev_ports() {
  log "Freeing ports 3210 (web) and 3211 (API)"
  kill_port 3210; kill_port 3211; sleep 1
}

start_dev_servers() {
  local web_port=3210 api_port=3211
  local lan_ip="${DEV_HOST_IP:-$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')}"
  local origins="http://127.0.0.1:${web_port},http://localhost:${web_port},http://${lan_ip}:${web_port}"
  export SES_CORS_ORIGINS="${SES_CORS_ORIGINS:+${SES_CORS_ORIGINS},}${origins}"
  export HOST="0.0.0.0"
  log "Starting dev servers — Ctrl+C to stop"
  step "Web : http://localhost:${web_port}  LAN: http://${lan_ip}:${web_port}"
  step "API : http://localhost:${api_port}  LAN: http://${lan_ip}:${api_port}"
  exec npx concurrently -k -n api,web -c blue,green \
    "npm run start:dev --workspace @ses/api" \
    "npm run dev:lan   --workspace @ses/web"
}

stop_all() {
  log "Stopping dev servers"
  kill_port 3210; kill_port 3211
  log "Stopping docker containers"
  compose down >/dev/null
  ok "All stopped"
}

# ── Database erase (no volume wipe) ──────────────────────────────────────────

erase_database() {
  local db="${PGDATABASE:-ses}" user="${PGUSER:-ses}" pass="${PGPASSWORD:-ses}" host="${PGHOST:-127.0.0.1}"
  warn "This will DROP the '$db' database and recreate it. All data will be lost."
  read -r -p "Type 'yes' to continue: " confirm
  [[ "$confirm" == "yes" ]] || die "Aborted."
  step "Terminating active connections…"
  PGPASSWORD="$pass" psql -h "$host" -U "$user" -d postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$db' AND pid<>pg_backend_pid();" >/dev/null
  step "Dropping $db…"
  PGPASSWORD="$pass" psql -h "$host" -U "$user" -d postgres -c "DROP DATABASE IF EXISTS $db;" >/dev/null
  step "Recreating $db…"
  PGPASSWORD="$pass" psql -h "$host" -U "$user" -d postgres -c "CREATE DATABASE $db OWNER $user;" >/dev/null
  ok "Database '$db' wiped and recreated"
}

# ── AI Pilot helpers ──────────────────────────────────────────────────────────

AI_DIR="${AI_DIR:-$HOME/ses-ai-test}"
AI_URL="${AI_SERVICE_URL:-http://localhost:8000}"
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
AI_MODEL="${AI_MODEL:-qwen2.5:7b}"

check_ollama() {
  hdr "AI Pilot: checking Ollama"
  command -v ollama >/dev/null 2>&1 || die "ollama not found. Install from https://ollama.ai"
  if ! curl -sf "$OLLAMA_URL" >/dev/null 2>&1; then
    warn "Ollama not running — attempting systemd start…"
    sudo systemctl start ollama 2>/dev/null || true
    sleep 2
    curl -sf "$OLLAMA_URL" >/dev/null 2>&1 || die "Ollama still down. Start it: sudo systemctl start ollama"
  fi
  ollama list 2>/dev/null | grep -q "$AI_MODEL" || die "Model $AI_MODEL not pulled. Run: ollama pull $AI_MODEL"
  ok "Ollama ready (model: $AI_MODEL)"
}

check_ai_dir() {
  [[ -d "$AI_DIR/venv" ]]    || die "$AI_DIR/venv not found. Set up the Python venv first."
  [[ -f "$AI_DIR/main.py" ]] || die "$AI_DIR/main.py missing. Drop FastAPI files into $AI_DIR"
  [[ -x "$AI_DIR/start-ai.sh" ]] || die "$AI_DIR/start-ai.sh missing or not executable."
  ok "FastAPI service files present in $AI_DIR"
}

ai_running() { curl -sf "$AI_URL/health" >/dev/null 2>&1; }

start_ai_service() {
  if ai_running; then
    ok "FastAPI already running at $AI_URL"
    return 0
  fi
  log "Starting FastAPI AI service…"
  (cd "$AI_DIR" && ./start-ai.sh)
  ai_running || die "FastAPI failed to start. Check: tail -50 $AI_DIR/ai-service.log"
  ok "FastAPI live at $AI_URL"
}

stop_ai_service() {
  if [[ -x "$AI_DIR/stop-ai.sh" ]]; then
    (cd "$AI_DIR" && ./stop-ai.sh) || true
  fi
  ok "FastAPI stopped"
}

# ── Status ────────────────────────────────────────────────────────────────────

show_status() {
  hdr "SES status"
  local db="${PGDATABASE:-ses}" user="${PGUSER:-ses}" pass="${PGPASSWORD:-ses}" host="${PGHOST:-127.0.0.1}"

  if compose ps postgres 2>/dev/null | grep -q "healthy\|running"; then
    ok "Postgres container: running"
  else
    warn "Postgres container: down"
  fi

  if compose ps redis 2>/dev/null | grep -q "healthy\|running"; then
    ok "Redis container: running"
  else
    warn "Redis container: down"
  fi

  if curl -sf "http://localhost:3211/api/v1/health" >/dev/null 2>&1; then
    ok "SES API  @ http://localhost:3211"
  else
    warn "SES API  : down"
  fi

  if curl -sf "http://localhost:3210" >/dev/null 2>&1; then
    ok "SES Web  @ http://localhost:3210"
  else
    warn "SES Web  : down"
  fi

  if curl -sf "$AI_URL/health" >/dev/null 2>&1; then
    ok "AI Pilot @ $AI_URL"
  else
    step "AI Pilot : not running (use './dev.sh ai' to start with AI)"
  fi

  if curl -sf "$OLLAMA_URL" >/dev/null 2>&1; then
    ok "Ollama   @ $OLLAMA_URL"
  else
    step "Ollama   : not running"
  fi
}

# ── Command dispatch ──────────────────────────────────────────────────────────

cmd="${1:-up}"

case "$cmd" in
  up|'')
    require_node; require_cmd npm; require_cmd docker
    load_env
    free_dev_ports
    ensure_docker_services
    prisma_generate; prisma_migrate; prisma_seed
    build_domain
    start_dev_servers
    ;;

  start)
    require_node; require_cmd npm
    load_env
    free_dev_ports
    build_domain
    start_dev_servers
    ;;

  down|stop)
    require_cmd docker
    stop_all
    ;;

  reset)
    require_node; require_cmd npm; require_cmd docker
    load_env
    warn "This will WIPE the Postgres volume (ses_pg_data). All local data will be lost."
    read -r -p "Type 'yes' to continue: " confirm
    [[ "$confirm" == "yes" ]] || die "Aborted."
    compose down -v >/dev/null
    free_dev_ports
    ensure_docker_services
    prisma_generate; prisma_migrate; prisma_seed
    build_domain
    start_dev_servers
    ;;

  erase-db)
    require_cmd docker
    load_env
    ensure_docker_services
    erase_database
    prisma_generate; prisma_migrate; prisma_seed
    ok "Database erased and re-seeded. Run './dev.sh start' to start the app."
    ;;

  ai)
    require_node; require_cmd npm; require_cmd docker
    load_env
    check_ollama
    check_ai_dir
    free_dev_ports
    ensure_docker_services
    start_ai_service
    prisma_generate; prisma_migrate; prisma_seed
    build_domain
    start_dev_servers
    ;;

  status)
    load_env 2>/dev/null || true
    show_status
    ;;

  logs)
    require_cmd docker
    compose logs -f
    ;;

  migrate)
    require_node; require_cmd npm; require_cmd docker
    load_env
    ensure_docker_services
    prisma_generate; prisma_migrate
    ok "Migrations applied. Run './dev.sh seed' to seed."
    ;;

  seed)
    require_node; require_cmd npm; require_cmd docker
    load_env
    ensure_docker_services
    prisma_seed
    ok "Database seeded."
    ;;

  install)
    require_node; require_cmd npm
    log "Installing workspace dependencies"
    npm install
    ok "Dependencies installed."
    ;;

  help|-h|--help)
    awk 'NR>1 { if (/^#/) { sub(/^# ?/, ""); print } else { exit } }' "$0"
    ;;

  *)
    die "Unknown command: $cmd. Run './dev.sh help' for usage."
    ;;
esac
