#!/usr/bin/env bash
set -euo pipefail

port=3001
pid_file="$RUNNER_TEMP/starhold-full-tier-server.pgid"

port_is_free() {
  if command -v fuser >/dev/null 2>&1; then
    ! fuser -s "$port/tcp" >/dev/null 2>&1
  else
    ! ss -H -ltn "sport = :$port" 2>/dev/null | grep -q .
  fi
}

kill_port_listener() {
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "$port/tcp" >/dev/null 2>&1 || true
  elif command -v lsof >/dev/null 2>&1; then
    listener_pids="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
    if [ -n "$listener_pids" ]; then
      while IFS= read -r pid; do
        kill "$pid" 2>/dev/null || true
      done <<< "$listener_pids"
    fi
  elif command -v ss >/dev/null 2>&1; then
    listener_pids="$(ss -H -ltnp "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
    if [ -n "$listener_pids" ]; then
      while IFS= read -r pid; do
        kill "$pid" 2>/dev/null || true
      done <<< "$listener_pids"
    fi
  fi
}

wait_for_free_port() {
  for _ in $(seq 1 30); do
    port_is_free && return 0
    sleep 1
  done
  return 1
}

stop_server() {
  if [ -f "$pid_file" ]; then
    pgid="$(cat "$pid_file")"
    if [[ "$pgid" =~ ^[0-9]+$ ]]; then
      kill -- "-$pgid" 2>/dev/null || true
    else
      echo "Invalid server process group ID in $pid_file" >&2
    fi
  fi

  if ! wait_for_free_port; then
    echo "Server process group did not free port $port; stopping its listener" >&2
    kill_port_listener
  fi

  if ! wait_for_free_port; then
    echo "Port $port is still in use after stopping the previous server" >&2
    return 1
  fi
  rm -f "$pid_file"
}

case "${1:-}" in
  start)
    if [ "$#" -ne 3 ]; then
      echo "Usage: $0 start <logname> <universe-key>" >&2
      exit 2
    fi
    logname="$2"
    universe_key="$3"
    stop_server

    log_file="$RUNNER_TEMP/starhold-full-tier-$logname.log"
    PORT="$port" \
      STARHOLD_E2E=1 \
      ALLOW_E2E_HOOKS=1 \
      STARHOLD_UNIVERSE_KEY="$universe_key" \
      setsid npm start > "$log_file" 2>&1 &
    pgid=$!
    echo "$pgid" > "$pid_file"

    for _ in $(seq 1 90); do
      if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null; then
        echo "server up for $logname"
        exit 0
      fi
      sleep 1
    done
    echo "server failed to become healthy for $logname" >&2
    cat "$log_file" || true
    exit 1
    ;;
  stop)
    if [ "$#" -ne 1 ]; then
      echo "Usage: $0 stop" >&2
      exit 2
    fi
    stop_server
    ;;
  *)
    echo "Usage: $0 start <logname> <universe-key> | stop" >&2
    exit 2
    ;;
esac
