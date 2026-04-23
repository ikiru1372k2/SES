#!/usr/bin/env bash
set -Eeuo pipefail

PORTS=(3210 3211)

log() {
  printf '[dev:ports] %s\n' "$*"
}

maybe_stop_docker_publishers() {
  if ! command -v docker >/dev/null 2>&1; then
    return
  fi
  if ! docker info >/dev/null 2>&1; then
    return
  fi

  local ids=()
  local id
  while IFS= read -r id; do
    [[ -n "$id" ]] && ids+=("$id")
  done < <(
    {
      docker ps --filter publish=3210 --format '{{.ID}}'
      docker ps --filter publish=3211 --format '{{.ID}}'
    } | sort -u
  )

  if ((${#ids[@]} > 0)); then
    log "Stopping Docker containers publishing 3210/3211..."
    docker stop "${ids[@]}" >/dev/null || true
  fi
}

kill_port_listeners() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return
  fi

  log "Killing listeners on :$port as current user..."
  echo "$pids" | sort -u | xargs -r kill -9 2>/dev/null || true

  local remaining
  remaining="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$remaining" ]] && sudo -n true >/dev/null 2>&1; then
    log "Killing remaining listeners on :$port with sudo..."
    echo "$remaining" | sort -u | xargs -r sudo -n kill -9 2>/dev/null || true
  fi
}

main() {
  maybe_stop_docker_publishers
  for port in "${PORTS[@]}"; do
    kill_port_listeners "$port"
  done
  sleep 1
}

main "$@"
