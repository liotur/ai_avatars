#!/bin/sh
# Demo process supervisor. One container, four processes.
set -eu

mkdir -p /data

if [ -z "${AUTOX_USERNAME:-}" ] && [ -n "${USERNAME:-}" ]; then
  export AUTOX_USERNAME="$USERNAME"
fi

cd /app

PORT=3000 pnpm --filter @avatars/avatar-manager exec tsx src/index.ts &
PORT=3001 pnpm --filter @avatars/avatar-mcp exec tsx src/index.ts &
PORT=3002 pnpm --filter @avatars/assistant exec tsx src/index.ts &

i=0
until curl -sf http://127.0.0.1:3000/v1/health >/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 40 ]; then
    echo "avatar-manager did not become ready" >&2
    exit 1
  fi
  sleep 0.5
done

if [ -z "${AUTOX_KEY:-}${LLM_API_KEY:-}" ]; then
  echo "AUTOX_KEY is empty. The library works. Chat answers need the key." >&2
fi

exec nginx -g "daemon off;"
