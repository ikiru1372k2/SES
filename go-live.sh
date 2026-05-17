#!/usr/bin/env bash
# go-live.sh — ONE command: full production stack + public Cloudflare URL.
#
# This is the single entrypoint for "make it live and give me the link".
# It composes the existing, security-reviewed scripts rather than
# reimplementing them:
#
#   1. ./deploy.sh local   — build + start the full prod stack
#                            (postgres, redis, minio, migrate, api, web,
#                             ai-sidecar, ollama), wait for health, pull
#                             the Ollama models the analytics agent needs.
#   2. ./expose.sh         — start a Cloudflare quick tunnel
#                            (TryCloudflare: no account/domain/token) and
#                            scrape the public https://*.trycloudflare.com
#                            URL out of the cloudflared logs.
#   3. Reconfigure the API for that public URL — this is the step no
#      existing script did: a quick-tunnel domain is random and changes
#      every run, so SES_CORS_ORIGINS / SES_BASE_URL must be rewritten in
#      .deploy.env and the api+web containers recreated, or the browser
#      hits CORS failures and cookies won't set on the public origin.
#   4. Verify the app answers through the public URL, then print it.
#
# Usage:
#   ./go-live.sh           Bring everything up and print the public URL.
#   ./go-live.sh stop      Stop the tunnel only (stack keeps running).
#   ./go-live.sh down      Stop the whole prod stack + tunnel (volumes kept).
#   ./go-live.sh url       Reprint the current public URL.
#   ./go-live.sh status    Stack health + current public URL.
#
# Idempotent: re-running picks up a (new) tunnel URL and re-points the API
# at it. Volumes are never deleted by this script.

set -Eeuo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="${SELF_DIR}/deploy.sh"
EXPOSE="${SELF_DIR}/expose.sh"
ENV_FILE="${SELF_DIR}/.deploy.env"
PROD_COMPOSE="${SELF_DIR}/docker-compose.prod.yml"

if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_GREEN=""; C_RED=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
fi
log()  { printf '%b[%s]%b %s\n' "${C_BLUE}" "go-live" "${C_RESET}" "$*"; }
ok()   { printf '%b[ok]%b %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
warn() { printf '%b[warn]%b %s\n' "${C_YELLOW}" "${C_RESET}" "$*" >&2; }
fail() { printf '%b[fail]%b %s\n' "${C_RED}" "${C_RESET}" "$*" >&2; exit 1; }

compose() { docker compose --env-file "$ENV_FILE" -f "$PROD_COMPOSE" "$@"; }

# Rewrite a KEY=VALUE line in .deploy.env in place (chmod stays 600).
set_env_kv() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # Use a non-/ delimiter; URLs contain slashes.
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >>"$ENV_FILE"
  fi
}

# The API only reads SES_CORS_ORIGINS / SES_BASE_URL / SES_COOKIE_* at
# startup, so changing them means recreating api (and web, which depends on
# it). Postgres/redis/minio/ollama/sidecar are untouched — no data churn.
repoint_api_to_url() {
  local public_url="$1"
  log "pointing the API at the public origin: ${public_url}"
  set_env_kv SES_BASE_URL "$public_url"
  # Keep localhost origins too so on-host curl / health checks still pass.
  set_env_kv SES_CORS_ORIGINS "${public_url},http://localhost:3210,http://127.0.0.1:3210"
  # Tunnel terminates TLS — the browser speaks HTTPS to the public origin,
  # so cookies must be Secure and SameSite must allow the cross-site nav
  # from the email/Teams escalation links.
  set_env_kv SES_COOKIE_SECURE true
  set_env_kv SES_COOKIE_SAMESITE lax
  log "recreating api + web with the new origin (data services untouched)…"
  compose up -d --no-deps --force-recreate api web
}

wait_for_local_health() {
  log "waiting for the stack to answer on http://localhost:3210 …"
  local n=0
  until curl -fsS http://localhost:3210/healthz >/dev/null 2>&1; do
    n=$((n + 1))
    (( n > 60 )) && fail "stack not healthy after ~3 min — check: ./deploy.sh logs"
    sleep 3
  done
  curl -fsS http://localhost:3210/api/v1/health >/dev/null 2>&1 \
    && ok "api healthy (via web proxy)" \
    || warn "web is up but /api/v1/health did not answer yet — continuing"
}

print_banner() {
  local url="$1"
  printf '\n'
  printf '%b┌────────────────────────────────────────────────────────────┐%b\n' "$C_GREEN" "$C_RESET"
  printf '%b│%b  SES PRODUCTION is live and reachable from anywhere:       %b│%b\n' "$C_GREEN" "$C_RESET" "$C_GREEN" "$C_RESET"
  printf '%b│%b                                                            %b│%b\n' "$C_GREEN" "$C_RESET" "$C_GREEN" "$C_RESET"
  printf '%b│%b  %b%s%b' "$C_GREEN" "$C_RESET" "$C_BOLD" "$url" "$C_RESET"
  local pad=$(( 56 - ${#url} )); (( pad < 0 )) && pad=0
  printf '%*s' "$pad" ''
  printf '%b│%b\n' "$C_GREEN" "$C_RESET"
  printf '%b└────────────────────────────────────────────────────────────┘%b\n' "$C_GREEN" "$C_RESET"
  printf '\n'
  log "stop tunnel only:  ./go-live.sh stop"
  log "take all down:     ./go-live.sh down   (volumes preserved)"
}

cmd_up() {
  command -v docker >/dev/null 2>&1 || fail "docker not found on PATH."
  [[ -f "$ENV_FILE" ]] || fail ".deploy.env missing — run ./deploy.sh local once to bootstrap it."

  log "1/4  building + starting the full production stack…"
  "$DEPLOY" local

  wait_for_local_health

  log "2/4  starting the Cloudflare quick tunnel…"
  "$EXPOSE" up

  log "3/4  resolving the public tunnel URL…"
  local url
  url="$("$EXPOSE" url)" || fail "could not read the tunnel URL — check: ./expose.sh logs"
  [[ "$url" == https://* ]] || fail "unexpected tunnel URL: ${url}"

  repoint_api_to_url "$url"
  wait_for_local_health

  log "4/4  verifying the app answers through the public URL…"
  local n=0
  until curl -fsS "${url}/healthz" >/dev/null 2>&1; do
    n=$((n + 1))
    if (( n > 20 )); then
      warn "public URL not answering yet (Cloudflare edge can take ~30 s)."
      warn "the stack is up locally; the URL should become reachable shortly."
      break
    fi
    sleep 3
  done
  (( n <= 20 )) && ok "public URL is serving the app."

  print_banner "$url"
}

cmd_stop()   { "$EXPOSE" stop; }
cmd_url()    { "$EXPOSE" url; }
cmd_down()   {
  "$EXPOSE" stop || true
  log "stopping the prod stack (volumes preserved)…"
  "$DEPLOY" stop
}
cmd_status() {
  "$DEPLOY" status || true
  echo
  local url
  if url="$("$EXPOSE" url 2>/dev/null)"; then
    ok "public URL: ${url}"
  else
    warn "no tunnel running — run ./go-live.sh to publish one."
  fi
}

main() {
  local sub="${1:-up}"
  case "$sub" in
    ""|up)   cmd_up ;;
    stop)    cmd_stop ;;
    down)    cmd_down ;;
    url)     cmd_url ;;
    status)  cmd_status ;;
    *)       fail "Unknown subcommand: $sub  (try: up | stop | down | url | status)" ;;
  esac
}

main "$@"
