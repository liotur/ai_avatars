# Avatars — architecture

People define avatars (a stance: perspective, voice, what it cares about, what it ignores). An assistant picks the avatar that fits a question, creates one when none fits, and answers as it.

## Components

```
UI (web)
├─ Avatars page ─────────── REST ──────────────────────────► Avatar manager ──► SQLite
└─ Assistant page ── REST ─► Assistant ── MCP ─► Avatar MCP ── REST ─┘
                             prompts, loop,
                             LLM calls ──► LLM provider
```

| Component | Owns | Talks to | Port |
|---|---|---|---|
| `web` | Avatars CRUD pages, chat page | Avatar manager (REST), Assistant (REST) | 5173 |
| `avatar-manager` | Avatar data and validation; the only writer of the database | SQLite | 3000 |
| `avatar-mcp` | Tool adapter; no data, no logic | Avatar manager (REST) | 3001 |
| `assistant` | Sessions, system prompts, classification, LLM calls | Avatar MCP, LLM provider | 3002 |

Each component does one thing. The assistant does not know where avatars are stored, and the avatar manager does not know an LLM exists.

## Contracts

- `contracts/avatar-service.openapi.yaml` — avatar REST API.
- `contracts/assistant.openapi.yaml` — sessions and messages. The public surface only.
- MCP tools (in `avatar-mcp`):

| Tool | Returns | Backed by |
|---|---|---|
| `list_avatars` | Summaries: `id`, `name`, `description`, `useWhen` | `GET /avatars`, projected |
| `get_avatar` | One full avatar | `GET /avatars/{id}` |
| `create_avatar` | The created avatar | `POST /avatars` |

The assistant gets no update or delete tools; editing stays with people.

## Assistant loop (per message)

1. `list_avatars` → summaries.
2. If the request names `avatarId`, use it. Otherwise **classify**: one LLM call with the classifier system prompt, the summaries, and the message. The model returns either an existing avatar id or a draft of a new one, plus a one-sentence reason. That shape lives in the assistant's code, not in the public contract.
3. On `propose`, call `create_avatar` with `createdBy: assistant`.
4. `get_avatar` → build the avatar system prompt.
5. Open the response stream: one `avatar` event (who is answering and how they were picked), then `delta` events as the second model call produces text, then `done`.

Classification and the answer use the same model.

Guards: an unknown `avatarId`, a draft rejected with 400, or a name conflict (409) is fed back to the model for **one** retry, then returns 502. The avatar manager's validation is the source of truth, because provider structured-output modes do not enforce every JSON Schema constraint.

Prompt assembly, by `intensity`:
- `subtle` — `perspective`, `caresAbout` (in order), and `ignores` decide what the answer covers. The voice is not applied.
- `balanced` — adds `voice`.
- `immersive` — adds a first-person, stay-in-character instruction.

Sessions are in memory. Each message is answered on its own; history attaches to the session later.

A seeded **Generalist** avatar (`useWhen`: simple factual or how-to questions) keeps trivial questions from creating new avatars.

## Tech stack

- **Language:** TypeScript, Node 22, pnpm workspace.
- **Contracts → code:** `@hey-api/openapi-ts` generates types, typed fetch clients, and Zod schemas from `contracts/` into `packages/contracts`.
- **HTTP services:** Hono with `@hono/zod-validator`, using the generated Zod schemas. Errors are returned as `application/problem+json`.
- **Storage:** SQLite (`better-sqlite3`) with Drizzle. `name` is `UNIQUE COLLATE NOCASE`, and list fields are JSON columns.
- **MCP:** `@modelcontextprotocol/sdk`, Streamable HTTP transport. Tool input schemas reuse the generated Zod schemas.
- **LLM:** Vercel AI SDK (`ai`) against the Amdocs AutoX Responses API (`POST {base}/responses`). One model classifies and answers. Settings are in [docs/LLM.md](docs/LLM.md). The classifier's output schema is defined in the assistant, next to the prompt. The answer is streamed to the client as server-sent events.
- **UI:** TypeScript (strict), React, Vite, TanStack Query for REST, and the generated clients. See [UI](#ui).
- **Tests:** Vitest. Contract tests check service responses against the specs. Assistant tests run against a mocked model.

## UI

The web app is TypeScript throughout and imports the generated client and Zod schemas from `packages/contracts`, so an API change fails the build, not the page.

- **Routes:** `/avatars` (library, detail, create, edit) and `/chat` (one session per page load).
- **Data:** TanStack Query for the avatar REST API. Mutations invalidate the list.
- **Forms:** React Hook Form with the generated Zod schemas, so the browser and the API apply the same rules.
- **Chat streaming:** `EventSource` only supports GET, and sending a message is a POST. The client calls `fetch` and parses the `text/event-stream` body itself, handling the `avatar`, `delta`, `done`, and `error` events.
- **Errors:** `application/problem+json` responses are shown by their `detail` field, with field errors placed next to the matching input.
- **Testing:** Vitest with Testing Library for components. One Playwright path (create an avatar, ask a question) once the stack runs in Docker.
- **Styling:** not decided. Use the `ui-ux-pro-max` skill when building the screens.

## Repo layout

```
contracts/                 OpenAPI specs (source of truth)
packages/contracts/        generated types, clients, Zod (do not edit)
apps/avatar-manager/       REST + SQLite, seed data
apps/avatar-mcp/           MCP server
apps/assistant/            loop, prompts, LLM adapter
apps/web/                  UI
Dockerfile                 demo image: all four processes, one port
docker-compose.yml         the one command
.env.example
```

## Configuration

Everything is configured through environment variables, read once at startup and validated with Zod. A missing or invalid value stops startup with a clear message.

| Variable | Used by | Example |
|---|---|---|
| `LLM_PROVIDER` | assistant | `autox` |
| `AUTOX_KEY` | assistant | API key. Sent as the `api-key` header. `LLM_API_KEY` is a fallback |
| `AUTOX_USERNAME` | assistant | Sent as the `username` header. `USERNAME` is a fallback |
| `AUTOX_BASE_URL` | assistant | `https://chat.autox.corp.amdocs.azr/api/v1/proxy/openai` |
| `AUTOX_API_VERSION` | assistant | `2025-03-01-preview` (query parameter) |
| `AUTOX_APPLICATION` | assistant | `autox-merged-ui` (header) |
| `LLM_MODEL` | assistant | `gpt-4.1-mini` |
| `AVATAR_MCP_URL` | assistant | `http://localhost:3001/mcp` (set inside the demo image) |
| `AVATAR_API_URL` | avatar-mcp | `http://localhost:3000/v1` (set inside the demo image) |
| `DATABASE_PATH` | avatar-manager | `./data/avatars.db` |
| `CORS_ORIGIN` | avatar-manager, assistant | only when the UI is on another origin |

The API key stays in the assistant. It never reaches the browser, the MCP server, or the avatar manager.

## Run

Copy `.env.example` to `.env`, set `AUTOX_KEY` and `AUTOX_USERNAME`, then:

```
docker compose up --build
```

Open `http://localhost:8080`. The SQLite file is on a named volume, so avatars survive a restart.

That image is for the demo only. It starts all four processes and publishes one port; the UI is served from the same origin and proxies to the two APIs. In a real deployment each component is its own image, with its own scaling and release, and the URLs between them are configuration.

While developing, `pnpm install && pnpm generate && pnpm dev` runs the four apps in watch mode on the ports in the Components table. The web app then reads `VITE_AVATAR_API_URL` and `VITE_ASSISTANT_API_URL`, because it is no longer on the same origin as the APIs.

## Out of scope for v1

Authentication, multiple users, chat history, avatar versioning, search and paging.
