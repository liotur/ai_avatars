# Demo only. One image runs every process so a laptop can start with one command.
# In a real deployment each component is its own image.
FROM node:22-bookworm

# pnpm is installed with npm, which honours HTTP_PROXY and HTTPS_PROXY, so the
# image also builds on a network that reaches the internet through a proxy.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ nginx ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && rm -f /etc/nginx/sites-enabled/default \
  && npm install -g pnpm@10.34.9

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/contracts/openapi-ts.avatar.ts packages/contracts/openapi-ts.assistant.ts packages/contracts/tsconfig.json packages/contracts/
COPY apps/avatar-manager/package.json apps/avatar-manager/
COPY apps/avatar-mcp/package.json apps/avatar-mcp/
COPY apps/assistant/package.json apps/assistant/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY contracts contracts
COPY packages/contracts packages/contracts
COPY apps apps
COPY tsconfig.base.json ./
COPY docker/nginx.conf /etc/nginx/conf.d/avatars.conf
COPY docker/start.sh /start.sh
RUN sed -i 's/\r$//' /start.sh \
  && chmod +x /start.sh \
  && node --input-type=module -e "import {createRequire} from 'node:module'; import {dirname} from 'node:path'; import {spawnSync} from 'node:child_process'; const require = createRequire('/app/apps/avatar-manager/package.json'); const dir = dirname(require.resolve('better-sqlite3/package.json')); const result = spawnSync('npm', ['run', 'install'], {cwd: dir, stdio: 'inherit'}); process.exit(result.status ?? 1);" \
  && pnpm generate \
  && VITE_AVATAR_API_URL=/v1 VITE_ASSISTANT_API_URL=/v1 pnpm --filter @avatars/web build

# The UI and both APIs share one origin here, so CORS is not exercised.
ENV DATABASE_PATH=/data/avatars.db \
  AVATAR_API_URL=http://127.0.0.1:3000/v1 \
  AVATAR_MCP_URL=http://127.0.0.1:3001/mcp \
  CORS_ORIGIN=http://localhost:8090

EXPOSE 8080
CMD ["/start.sh"]
