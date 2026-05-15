#!/usr/bin/env bash
# expose.sh — publish the running SES prod stack via a Cloudflare quick tunnel.
#
# What this does, in one command:
#   1. Make sure the prod stack is up (./deploy.sh local if not).
#   2. Start `cloudflared tunnel --url http://localhost:3210` as a background
#      container on the host network.
#   3. Scrape the printed trycloudflare.com URL out of the cloudflared logs.
#   4. Print it.
#
# Quick tunnels are "TryCloudflare" — no account, no domain, no token needed.
# The URL is a random subdomain and changes every run.
#
# Usage:
#   ./expose.sh             Bring up + tunnel, print URL, keep running.
#   ./expose.sh stop        Stop the tunnel container only (stack keeps running).
#   ./expose.sh logs        Tail the cloudflared container logs.
#   ./expose.sh url         Print the current public URL and exit.

set -Eeuo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TUNNEL_CONTAINER="ses-cloudflared-quick"
TUNNEL_IMAGE="cloudflare/cloudflared:latest"
LOCAL_WEB_URL="http://localhost:3210"
HEALTHZ_URL="${LOCAL_WEB_URL}/healthz"
LOG_TAIL_LINES=200

# Colours — only if stdout is a TTY.
if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_GREEN=""; C_RED=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
fi
log()  { printf '%b[%s]%b %s\n' "${C_BLUE}" "expose" "${C_RESET}" "$*"; }
ok()   { printf '%b[ok]%b %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
warn() { printf '%b[warn]%b %s\n' "${C_YELLOW}" "${C_RESET}" "$*" >&2; }
fail() { printf '%b[fail]%b %s\n' "${C_RED}" "${C_RESET}" "$*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "$1 not found on PATH"; }

# Extract the first trycloudflare.com URL from the container's log stream.
# cloudflared prints something like:
#   2026-…  INF +--------------------------------------------------------------+
#   2026-…  INF |  Your quick Tunnel has been created! Visit it at (it may take a few seconds to be reachable):
#   2026-…  INF |  https://shaped-thinking-leadership-asia.trycloudflare.com   |
extract_url_from_logs() {
  local logs="$1"
  printf '%s' "$logs" \
    | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' \
    | head -1
}

ensure_stack_running() {
  if curl -fsS "$HEALTHZ_URL" >/dev/null 2>&1; then
    ok "prod stack is healthy at ${LOCAL_WEB_URL}"
    return
  fi
  warn "prod stack not responding at ${HEALTHZ_URL} — running ./deploy.sh local"
  "${SELF_DIR}/deploy.sh" local
  # deploy.sh already waits on /healthz, but double-check before continuing.
  curl -fsS "$HEALTHZ_URL" >/dev/null 2>&1 \
    || fail "deploy.sh local finished but ${HEALTHZ_URL} still does not respond. Check ./deploy.sh logs."
}

# Wait until the quick-tunnel URL is present in the logs (it's printed
# within ~5–15 s of the container starting). 60-second timeout.
wait_for_tunnel_url() {
  local attempts=0
  local logs url
  while (( attempts < 30 )); do
    logs=$(docker logs --tail "$LOG_TAIL_LINES" "$TUNNEL_CONTAINER" 2>&1 || true)
    url=$(extract_url_from_logs "$logs")
    if [[ -n "$url" ]]; then
      printf '%s' "$url"
      return 0
    fi
    sleep 2
    attempts=$((attempts + 1))
  done
  return 1
}

cmd_up() {
  require_cmd docker
  require_cmd curl
  ensure_stack_running

  # If the container already exists (running or stopped), reuse it: stop if
  # running, then remove. cloudflared quick tunnels are stateless so a fresh
  # run is cheap and avoids stale-URL confusion.
  if docker ps -a --format '{{.Names}}' | grep -qx "$TUNNEL_CONTAINER"; then
    log "removing previous tunnel container ($TUNNEL_CONTAINER)…"
    docker rm -f "$TUNNEL_CONTAINER" >/dev/null
  fi

  log "starting cloudflared quick tunnel → ${LOCAL_WEB_URL}"
  # --network host is the simplest way for the container to reach the
  # host's port 3210 without ses-network membership. Quick tunnels do not
  # need any inbound connectivity, so host-network has no security cost.
  docker run -d \
    --name "$TUNNEL_CONTAINER" \
    --network host \
    --restart unless-stopped \
    "$TUNNEL_IMAGE" \
    tunnel --no-autoupdate --url "$LOCAL_WEB_URL" >/dev/null

  log "waiting for cloudflared to publish a URL (usually ~10 s)…"
  local url
  if ! url=$(wait_for_tunnel_url); then
    warn "no trycloudflare.com URL appeared after 60 s. Last 30 log lines:"
    docker logs --tail 30 "$TUNNEL_CONTAINER" >&2 || true
    fail "tunnel failed to publish a URL"
  fi

  printf '\n'
  printf '%b┌────────────────────────────────────────────────────────────┐%b\n' "$C_GREEN" "$C_RESET"
  printf '%b│%b  SES is now reachable from anywhere at:                    %b│%b\n' "$C_GREEN" "$C_RESET" "$C_GREEN" "$C_RESET"
  printf '%b│%b                                                            %b│%b\n' "$C_GREEN" "$C_RESET" "$C_GREEN" "$C_RESET"
  printf '%b│%b  %b%s%b' "$C_GREEN" "$C_RESET" "$C_BOLD" "$url" "$C_RESET"
  # Right-pad with spaces to align the closing bar regardless of URL length.
  local pad=$(( 56 - ${#url} ))
  (( pad < 0 )) && pad=0
  printf '%*s' "$pad" ''
  printf '%b│%b\n' "$C_GREEN" "$C_RESET"
  printf '%b└────────────────────────────────────────────────────────────┘%b\n' "$C_GREEN" "$C_RESET"
  printf '\n'

  log "tunnel container: $TUNNEL_CONTAINER  (docker logs -f $TUNNEL_CONTAINER)"
  log "stop with:        ./expose.sh stop"
}

cmd_stop() {
  if docker ps -a --format '{{.Names}}' | grep -qx "$TUNNEL_CONTAINER"; then
    docker rm -f "$TUNNEL_CONTAINER" >/dev/null
    ok "tunnel stopped (prod stack still running — use ./deploy.sh stop to take it down)."
  else
    warn "no tunnel container found ($TUNNEL_CONTAINER)."
  fi
}

cmd_logs() {
  docker logs -f --tail 100 "$TUNNEL_CONTAINER"
}

cmd_url() {
  local logs url
  logs=$(docker logs --tail "$LOG_TAIL_LINES" "$TUNNEL_CONTAINER" 2>&1 || true)
  url=$(extract_url_from_logs "$logs")
  if [[ -z "$url" ]]; then
    fail "no URL found. Is the tunnel running? Try ./expose.sh"
  fi
  printf '%s\n' "$url"
}

main() {
  local sub="${1:-up}"
  case "$sub" in
    ""|up)   cmd_up ;;
    stop)    cmd_stop ;;
    logs)    cmd_logs ;;
    url)     cmd_url ;;
    *)       fail "Unknown subcommand: $sub  (try: up | stop | logs | url)" ;;
  esac
}

main "$@"
