#!/usr/bin/env bash
# deploy.sh — SES deploy helper.
#
# Everything you need to bring SES up on this machine or on a remote EC2
# host, without leaving the repo. The goal is: one command, no detours.
#
# Usage:
#   ./deploy.sh local          Build and run the prod docker stack locally.
#   ./deploy.sh demo           Like local, but seeds demo users + enables dev login.
#   ./deploy.sh stop           Stop + remove containers (preserves volumes).
#   ./deploy.sh prune          Stop + remove containers AND volumes (destructive).
#   ./deploy.sh logs [svc]     Tail logs of the stack (optionally one service).
#   ./deploy.sh status         Show service status + health.
#   ./deploy.sh ec2 <host>     Deploy to an SSH-reachable host (typically EC2).
#   ./deploy.sh doctor         Check prerequisites.
#   ./deploy.sh help           Print this help.
#
# Environment (used by `ec2`):
#   EC2_USER                  SSH username                        (default: ubuntu)
#   EC2_KEY                   Path to SSH private key             (default: ~/.ssh/id_rsa)
#   EC2_DIR                   Remote install directory            (default: /opt/ses)
#   SES_AUTH_SECRET_DOCKER    Cookie secret for prod (≥ 32 chars; auto-generated if unset)
#   SES_BASE_URL              Public HTTPS URL (e.g. https://ses.example.com)
#   SES_CORS_ORIGINS          Comma-separated allowed browser origins
#   SES_COOKIE_SECURE         Set true behind HTTPS
#   SES_SMTP_URL              Outbound mail (optional)
#   SES_TEAMS_INCOMING_WEBHOOK_URL    Teams webhook (optional)

set -Eeuo pipefail

# --- Constants -------------------------------------------------------------

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_COMPOSE="${SELF_DIR}/docker-compose.prod.yml"
DEMO_COMPOSE="${SELF_DIR}/docker-compose.demo.yml"
LOCAL_ENV_FILE="${SELF_DIR}/.deploy.env"

# Colours — only if stdout is a TTY.
if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_GREEN=""; C_RED=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
fi

log()   { printf '%b[%s]%b %s\n' "${C_BLUE}" "ses-deploy" "${C_RESET}" "$*"; }
ok()    { printf '%b[ok]%b %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
warn()  { printf '%b[warn]%b %s\n' "${C_YELLOW}" "${C_RESET}" "$*" >&2; }
fail()  { printf '%b[fail]%b %s\n' "${C_RED}" "${C_RESET}" "$*" >&2; exit 1; }

# --- Helpers ---------------------------------------------------------------

require_cmd() {
  local cmd="$1"; local hint="${2:-}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "'$cmd' not found on PATH. ${hint}"
  fi
}

# Choose the docker compose invocation. Compose v2 (docker compose) is
# preferred; fall back to docker-compose v1 if that's what's installed.
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    fail "Neither 'docker compose' nor 'docker-compose' is available."
  fi
}

# Generate a 32-byte hex secret without assuming any particular tool is
# present. Falls back gracefully if openssl is missing.
generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif [[ -r /dev/urandom ]]; then
    head -c 32 /dev/urandom | od -An -vtx1 | tr -d ' \n'
  else
    fail "No way to generate a secret — install openssl."
  fi
}

# Write a .deploy.env the compose files can read. We materialise a file
# instead of exporting so the values don't leak into unrelated shell state.
write_env_file() {
  local secret="${SES_AUTH_SECRET_DOCKER:-}"
  if [[ -z "$secret" || ${#secret} -lt 32 ]]; then
    secret="$(generate_secret)"
    warn "SES_AUTH_SECRET_DOCKER was empty or too short; generated a fresh 64-char hex secret."
  fi
  cat >"$LOCAL_ENV_FILE" <<EOF
SES_AUTH_SECRET_DOCKER=${secret}
SES_BASE_URL=${SES_BASE_URL:-http://localhost:3210}
SES_CORS_ORIGINS=${SES_CORS_ORIGINS:-http://localhost:3210,http://127.0.0.1:3210}
SES_COOKIE_SECURE=${SES_COOKIE_SECURE:-false}
SES_COOKIE_SAMESITE=${SES_COOKIE_SAMESITE:-lax}
SES_SMTP_URL=${SES_SMTP_URL:-}
SES_MAIL_FROM=${SES_MAIL_FROM:-}
SES_TEAMS_INCOMING_WEBHOOK_URL=${SES_TEAMS_INCOMING_WEBHOOK_URL:-}
CLOUDFLARED_TOKEN=${CLOUDFLARED_TOKEN:-}
EOF
  chmod 600 "$LOCAL_ENV_FILE"
}

# --- Commands --------------------------------------------------------------

cmd_help() {
  # Print every leading comment line after the shebang, stripping the
  # comment markers. Stops at the first non-comment line.
  awk 'NR>1 { if (/^#/) { sub(/^# ?/, ""); print } else { exit } }' "$0"
}

cmd_doctor() {
  local problems=0
  log "Checking prerequisites…"

  if command -v docker >/dev/null 2>&1; then
    ok "docker: $(docker --version)"
  else
    warn "docker: missing"
    problems=$((problems + 1))
  fi

  if docker compose version >/dev/null 2>&1; then
    ok "docker compose: $(docker compose version | head -1)"
  elif command -v docker-compose >/dev/null 2>&1; then
    ok "docker-compose (v1): $(docker-compose --version)"
  else
    warn "docker compose: missing"
    problems=$((problems + 1))
  fi

  if command -v node >/dev/null 2>&1; then
    ok "node: $(node -v)"
  else
    warn "node: missing (optional — only for non-docker dev)"
  fi

  if command -v rsync >/dev/null 2>&1; then
    ok "rsync: $(rsync --version | head -1)"
  else
    warn "rsync: missing (required for 'ec2' subcommand)"
  fi

  # Verify the compose files are present.
  for f in "$PROD_COMPOSE" "$DEMO_COMPOSE"; do
    if [[ -f "$f" ]]; then
      ok "compose file: $(basename "$f")"
    else
      warn "compose file missing: $f"
      problems=$((problems + 1))
    fi
  done

  # Check for port conflicts on the host (local deploy only).
  for port in 3210; do
    if command -v ss >/dev/null 2>&1 && ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN; then
      warn "port $port is already in use on this host"
    fi
  done

  if [[ $problems -gt 0 ]]; then
    fail "$problems blocker(s) above. Fix them before running 'local'/'ec2'."
  fi
  ok "All checks passed."
}

cmd_local() {
  require_cmd docker "Install Docker (https://docs.docker.com/engine/install/)."
  write_env_file
  local profile_args=()
  if [[ -n "${CLOUDFLARED_TOKEN:-}" ]]; then
    profile_args=(--profile tunnel)
    log "CLOUDFLARED_TOKEN detected — bringing up the cloudflared tunnel container too."
  fi
  log "Building and starting the prod stack (docker-compose.prod.yml)…"
  compose --env-file "$LOCAL_ENV_FILE" "${profile_args[@]}" -f "$PROD_COMPOSE" up --build -d
  log "Waiting for web healthcheck…"
  local attempts=0
  until curl -fsS "http://localhost:3210/healthz" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [[ $attempts -gt 40 ]]; then
      warn "Web not healthy after ~2 minutes. Check: ./deploy.sh logs"
      break
    fi
    sleep 3
  done
  ok "SES is up at http://localhost:3210"
}

cmd_demo() {
  require_cmd docker "Install Docker first."
  write_env_file
  log "Building and starting the demo overlay (seeded users + dev login)…"
  compose --env-file "$LOCAL_ENV_FILE" \
    -f "$PROD_COMPOSE" -f "$DEMO_COMPOSE" up --build -d
  ok "Demo stack up at http://localhost:3210 (dev-login enabled)."
}

cmd_stop() {
  log "Stopping containers (volumes preserved)…"
  compose -f "$PROD_COMPOSE" down
  ok "Stopped."
}

cmd_prune() {
  warn "This will delete postgres + redis volumes. Ctrl-C to abort."
  sleep 3
  compose -f "$PROD_COMPOSE" down -v
  ok "Pruned."
}

cmd_logs() {
  local svc="${1:-}"
  if [[ -n "$svc" ]]; then
    compose -f "$PROD_COMPOSE" logs -f --tail 200 "$svc"
  else
    compose -f "$PROD_COMPOSE" logs -f --tail 200
  fi
}

cmd_status() {
  compose -f "$PROD_COMPOSE" ps
  echo
  log "Health:"
  if curl -fsS "http://localhost:3210/healthz" >/dev/null 2>&1; then
    ok "web (3210): healthy"
  else
    warn "web (3210): not responding"
  fi
  if curl -fsS "http://localhost:3210/api/v1/health" >/dev/null 2>&1; then
    ok "api (via web proxy): healthy"
  else
    warn "api: not responding"
  fi
}

# --- ec2 --------------------------------------------------------------------

cmd_ec2() {
  local host="${1:-}"
  [[ -n "$host" ]] || fail "Usage: ./deploy.sh ec2 <host>"
  local user="${EC2_USER:-ubuntu}"
  local key="${EC2_KEY:-$HOME/.ssh/id_rsa}"
  local remote_dir="${EC2_DIR:-/opt/ses}"

  require_cmd ssh "Install OpenSSH client."
  require_cmd rsync "Install rsync."
  [[ -r "$key" ]] || fail "SSH key not readable: $key"

  local ssh_cmd=(ssh -i "$key" -o StrictHostKeyChecking=accept-new "${user}@${host}")

  log "1/4  Ensuring docker is installed on ${user}@${host}…"
  "${ssh_cmd[@]}" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
if ! command -v docker >/dev/null 2>&1; then
  echo "[ec2] installing docker via upstream get.docker.com script…"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "[ec2] installing docker-compose plugin…"
  sudo apt-get update -y && sudo apt-get install -y docker-compose-plugin
fi
sudo mkdir -p /opt/ses
sudo chown "$USER":"$USER" /opt/ses
REMOTE

  log "2/4  Syncing source to ${user}@${host}:${remote_dir}…"
  rsync -az --delete \
    --exclude node_modules --exclude dist --exclude .git \
    --exclude coverage --exclude .vite --exclude '.deploy.env' \
    -e "ssh -i $key -o StrictHostKeyChecking=accept-new" \
    "${SELF_DIR}/" "${user}@${host}:${remote_dir}/"

  log "3/4  Writing .deploy.env on the host from your local environment…"
  local secret="${SES_AUTH_SECRET_DOCKER:-$(generate_secret)}"
  "${ssh_cmd[@]}" "cat > ${remote_dir}/.deploy.env" <<EOF
SES_AUTH_SECRET_DOCKER=${secret}
SES_BASE_URL=${SES_BASE_URL:-http://${host}:3210}
SES_CORS_ORIGINS=${SES_CORS_ORIGINS:-http://${host}:3210}
SES_COOKIE_SECURE=${SES_COOKIE_SECURE:-false}
SES_SMTP_URL=${SES_SMTP_URL:-}
SES_MAIL_FROM=${SES_MAIL_FROM:-}
SES_TEAMS_INCOMING_WEBHOOK_URL=${SES_TEAMS_INCOMING_WEBHOOK_URL:-}
EOF
  "${ssh_cmd[@]}" "chmod 600 ${remote_dir}/.deploy.env"

  log "4/4  Building and starting the stack remotely (this can take a few minutes)…"
  "${ssh_cmd[@]}" "cd ${remote_dir} && chmod +x deploy.sh && ./deploy.sh local"

  ok "Deployed to http://${host}:3210"
  log "Tail logs:    ssh -i ${key} ${user}@${host} 'cd ${remote_dir} && ./deploy.sh logs'"
  log "Service list: ssh -i ${key} ${user}@${host} 'cd ${remote_dir} && ./deploy.sh status'"
}

# --- Dispatcher ------------------------------------------------------------

main() {
  local sub="${1:-help}"
  case "$sub" in
    help|-h|--help) cmd_help ;;
    doctor)         cmd_doctor ;;
    local)          cmd_local ;;
    demo)           cmd_demo ;;
    stop)           cmd_stop ;;
    prune)          cmd_prune ;;
    logs)           shift; cmd_logs "${1:-}" ;;
    status)         cmd_status ;;
    ec2)            shift; cmd_ec2 "${1:-}" ;;
    *)              fail "Unknown subcommand: $sub (try ./deploy.sh help)" ;;
  esac
}

main "$@"
