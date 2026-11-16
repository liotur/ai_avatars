#!/bin/bash
# Builds the demo image.
#
# Building downloads from the internet (Docker Hub, Debian, npm). On a network
# that reaches the internet only through a proxy, such as the Amdocs VPN,
# Docker does not use the proxy by itself, so this script builds through a
# helper that does. It uses the proxy in HTTPS_PROXY, or the one given as the
# first argument; with no proxy it builds the plain way.
#
#   docker/build-image.sh
#   docker/build-image.sh http://proxy.example.com:8080
set -euo pipefail
cd "$(dirname "$0")/.."

image="ai-avatars:latest"
proxy="${1:-${HTTPS_PROXY:-${https_proxy:-}}}"

if [ -z "$proxy" ]; then
  echo "No proxy set, building directly."
  docker compose build
  exit 0
fi

echo "Building through the proxy $proxy."
builder="ai-avatars-proxy"
if ! docker buildx inspect "$builder" >/dev/null 2>&1; then
  docker buildx create --name "$builder" --driver docker-container \
    --driver-opt "env.HTTP_PROXY=$proxy" --driver-opt "env.HTTPS_PROXY=$proxy" \
    --driver-opt "env.NO_PROXY=localhost" >/dev/null
fi

docker buildx build --builder "$builder" \
  --build-arg "HTTP_PROXY=$proxy" --build-arg "HTTPS_PROXY=$proxy" \
  --build-arg "http_proxy=$proxy" --build-arg "https_proxy=$proxy" \
  --build-arg "NO_PROXY=localhost,127.0.0.1" --build-arg "no_proxy=localhost,127.0.0.1" \
  --load -t "$image" .

# The helper is only needed while building. Stopping it frees its resources;
# its cache is kept, so the next build is quicker.
docker buildx stop "$builder" >/dev/null 2>&1 || true
echo "Built $image. Start it with: docker compose up -d"
