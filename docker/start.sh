#!/bin/bash
# Demo process supervisor. One container, four processes.
# If any of them stops, the container stops, so a failure is never silent.
set -euo pipefail

mkdir -p /data
cd /app

pids=()

# run <app> <port> [command prefix...]
run() {
  local dir="$1" port="$2"
  shift 2
  (cd "apps/$dir" && PORT="$port" exec "$@" node --import tsx src/index.ts) &
  pids+=($!)
}

stop() {
  trap - TERM INT
  kill "${pids[@]}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap 'stop; exit 0' TERM INT

# True while every started process is still running.
all_running() {
  local pid
  for pid in "${pids[@]}"; do
    kill -0 "$pid" 2>/dev/null || return 1
  done
}

fail() {
  echo "$1" >&2
  stop
  exit 1
}

# Only the assistant is given the model key.
run avatar-manager 3000 env -u LLM_API_KEY -u AUTOX_KEY
run avatar-mcp 3001 env -u LLM_API_KEY -u AUTOX_KEY
run assistant 3002

wait_for() {
  local name="$1" url="$2" i=0
  until curl -sf "$url" >/dev/null; do
    all_running || fail "A process stopped while starting. See the lines above for the reason."
    i=$((i + 1))
    [ "$i" -le 60 ] || fail "$name did not become ready"
    sleep 0.5
  done
}

wait_for avatar-manager http://127.0.0.1:3000/v1/health
wait_for avatar-mcp http://127.0.0.1:3001/health
wait_for assistant http://127.0.0.1:3002/v1/health

nginx -g "daemon off;" &
pids+=($!)

all_running || fail "A process stopped while starting. See the lines above for the reason."
echo "Avatars is ready. Open the address published for port 8080 (http://localhost:8090 with docker compose)."

# Checked once a second. The sleep runs in the background so a stop signal is handled at once.
while all_running; do
  sleep 1 &
  wait $! || true
done
fail "A process stopped, so the container is stopping. See the lines above for the reason."
