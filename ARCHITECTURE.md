# Avatars — architecture

People define avatars (a stance: perspective, voice, what it cares about, what it ignores). An assistant picks the avatar that fits a question, creates one when none fits, and answers as it.

## Components

```
UI (web)
├─ Library page ─────────── REST ──────────────────────────► Avatar manager ──► SQLite
└─ Chat page ─────── REST ─► Assistant ── MCP ─► Avatar MCP ── REST ─┘
                             prompts, loop,
                             model calls ──► language model provider
```

| Component | Owns | Talks to | Port |
|---|---|---|---|
| `web` | Library pages (create, view, edit, delete) and the chat page | Avatar manager (REST), Assistant (REST) | 5173 |
| `avatar-manager` | Avatar data and validation; the only writer of the database | SQLite | 3000 |
| `avatar-mcp` | Tool adapter; no data, no logic | Avatar manager (REST) | 3001 |
| `assistant` | Sessions, system prompts, classification, model calls | Avatar MCP, model provider | 3002 |

Each component does one thing. The assistant does not know where avatars are stored, and the avatar manager does not know a language model exists.

## Contracts

- `contracts/avatar-service.openapi.yaml` — avatar REST API.
- `contracts/assistant.openapi.yaml` — assistant status, sessions, and messages. The public surface only.
- MCP tools (in `avatar-mcp`):

| Tool | Returns | Backed by |
|---|---|---|
| `list_avatars` | Summaries: `id`, `name`, `description`, `useWhen` | `GET /avatars`, projected |
| `get_avatar` | One full avatar | `GET /avatars/{id}` |
| `create_avatar` | The created avatar | `POST /avatars` |

The assistant gets no update or delete tools; editing stays with people. [docs/CONTRACTS.md](docs/CONTRACTS.md) lists every operation.

## Assistant loop (per message)

The code calls the tools; the model never decides whether to fetch avatars. That makes the retrieval certain, and leaves the model three jobs: which avatar, what to say, and whether the draft is good enough to show.

1. `list_avatars` → summaries.
2. If the request names `avatarId`, use it. Otherwise **classify**: one model call with the classifier system prompt, the summaries, the last turns of the chat, and the message. The model replies with either an existing avatar id or a draft of a new avatar, plus a one-sentence reason that is shown to the person. The shape of that reply lives in the assistant's code, not in the public contract.
3. On a draft, call `create_avatar` with `createdBy: assistant`.
4. `get_avatar` → build the avatar system prompt.
5. Open the response stream with one `avatar` event (who is answering and how they were picked).
6. **Draft**: a second model call writes the answer, with the earlier turns of the chat as context. The draft is streamed as work in progress (`draft` events); it is not the answer yet.
7. **Check**: a third model call judges the draft. If it passes, it is confirmed as the answer. If it fails, the avatar writes it again once, with the checker's advice, and the rewrite is sent as it is written.
8. `done`. The exchange is remembered.

All three calls use the same model. With `ANSWER_CHECK=off`, steps 6 and 7 collapse into one: the answer is sent as it is written, unchecked.

### Choosing or drafting

The classifier prompt (`apps/assistant/src/prompts.ts`) tells the model to:

- read an avatar's name, description, and `useWhen` together, so an avatar without `useWhen` can still be chosen;
- choose the avatar a message names;
- prefer an existing avatar that is a reasonable fit, and draft only when the message needs a stance none of them has;
- keep a general-purpose avatar for greetings, small talk, and simple questions, and not use it as a fallback for advice, judgment calls, or specialist topics;
- stay with the avatar that answered last when the message continues the conversation, and decide afresh when the subject changes or the person asks for another avatar;
- write a draft for the kind of question, not the one message, with one to three `useWhen` entries, so the new avatar can be chosen again;
- treat the message as a question to route, not as instructions.

The prompt puts these as numbered steps, to be taken in order, and has the model name the subject of the message and the ideal person to answer it before it looks at the list. Without that, a small model settles for the nearest avatar instead of noticing that none fits. The model fills those two fields before the decision in its JSON reply, so it reasons first.

The prompt also states the contract's limits (name 60 characters, description 280, and so on), so a draft is normally accepted the first time. The call is made with temperature 0, so the same message is routed the same way each time.

### Guards

The model's reply is checked against a schema built from the avatar contract. An unusable reply (not JSON, a field over a limit, an id that is not in the list) and a draft the avatar manager rejects (400, or 409 for a name that is taken) are each fed back to the model with the reason for **one** retry. If the retry is also unusable, the request ends with 502 and that reason. A provider failure (timeout, 401, 5xx) is not retried. The avatar manager's validation stays the source of truth.

Without a configured model the assistant still starts. `GET /assistant` reports `ready: false` with what to change, and a message is refused with 503.

### Answering

How far the avatar shapes the answer depends on its `intensity`:

- `subtle` — `perspective`, `caresAbout` (in order), and `ignores` decide what the answer covers. The model answers in its own plain wording and does not role-play.
- `balanced` — the same, in the avatar's `voice`, without claiming to be the character.
- `immersive` — the avatar speaks, in the first person.

### Checking the answer

The draft is checked before the person sees it (`apps/assistant/src/evaluate.ts`, and the checker's prompt in `prompts.ts`). The checker is given the avatar, the message, the last turns of the chat, and the draft, and answers four questions with true or false:

- `answers` — it answers what was asked, without dodging or stopping half-way;
- `sound` — nothing in it is clearly false or contradicts itself;
- `stance` — it is written from the avatar's perspective, weighs what the avatar cares about most, and leaves out what it ignores;
- `voice` — the wording fits the avatar's intensity.

The checker only judges. When a check fails, its advice goes back to the avatar, which writes the answer again; that rewrite is not checked a second time. A message therefore takes at most five model calls: two classifier attempts, the draft, the check, and one rewrite (plus one repeat of a decision call for a model that does not accept temperature 0). When the check itself cannot run (the provider fails, or its reply cannot be read), the draft is shown and labelled as not checked: the check is a quality step, not a gate.

The stream keeps the two apart. `stage` events say what is happening (`drafting`, `checking`, `revising`). `draft` events carry the draft as it is written, and the UI shows it as thinking. One `evaluation` event gives the verdict (`passed`, `revised`, or `skipped`). Only `delta` events are the answer: the whole draft in one piece when it passed, the rewrite piece by piece when it did not. A client that reads only `delta` never shows a rejected draft; with verdict `skipped` the answer is unchecked, and a rewrite is not checked again.

### Memory

A session is one chat, and the assistant remembers its turns (`apps/assistant/src/conversation.ts`): the question, the answer as far as it arrived, and which avatar gave it.

- The classifier is shown the last three turns, shortened, so it can tell a follow-up from a new subject.
- The answer call is shown the newest turns that fit a size budget (at most twelve), as alternating user and assistant messages. When another avatar answered earlier in the same chat, the prompt says so.
- An answer that was stopped or failed part-way is remembered as far as it got, because that is what the person saw.

The avatar is decided for every message, so one chat can move between avatars. Sessions are in memory only: a restart forgets them, and so does the store once it holds more than 200 (the one unused for longest goes first). The UI then opens a new session and says the earlier messages are no longer remembered. "New chat" in the UI does the same on purpose.

A library starts with nine avatars (`apps/avatar-manager/src/starters.ts`), chosen to answer the same question in visibly different ways: Generalist, Roast Master, Software Engineer, QA Tester, Skeptical CFO, Patient Teacher, Philosopher, Psychiatrist, and Future Me at 80. The **Generalist** (`useWhen`: simple factual questions, how-to questions, greetings) keeps trivial questions from creating new avatars. The starters are added once per database. They are ordinary avatars: each can be edited or deleted, and a deleted one does not come back. A database that already holds avatars gets the starters whose names are still free.

## Tech stack

- **Language:** TypeScript, Node 22, pnpm workspace.
- **Contracts → code:** `@hey-api/openapi-ts` generates types, typed fetch clients, and Zod schemas from `contracts/` into `packages/contracts/src` (`pnpm generate`; not committed).
- **HTTP services:** Hono with `@hono/zod-validator`, using the generated Zod schemas. Errors are returned as `application/problem+json`.
- **Storage:** SQLite (`better-sqlite3`) with Drizzle. Names are unique without regard to letter case, and list fields are JSON columns.
- **MCP:** `@modelcontextprotocol/sdk`, Streamable HTTP transport, stateless (a fresh server per request). Tool input schemas are written by hand to mirror the avatar contract, with descriptions for the model.
- **Language model:** Amdocs AutoX, through a small fetch client in the assistant. `autox.ts` is the request format (the OpenAI Responses API with AutoX headers); `model.ts` holds what does not depend on the format: timeouts, error wording, reading the answer stream. A second format, OpenAI chat completions (`chat.ts`), lets the project run on another provider when AutoX is out of reach. Settings are in [docs/LLM.md](docs/LLM.md). The answer is streamed to the client as server-sent events.
- **UI:** TypeScript (strict), React, Vite, TanStack Query for REST, and the generated clients. See [UI](#ui).
- **Tests:** Vitest in every package. The services are tested in process against temporary databases, the assistant against a scripted model and a fake provider, and the UI with Testing Library. There is no end-to-end browser test yet.

## UI

The web app is TypeScript throughout and imports the generated client and Zod schemas from `packages/contracts`, so an API change fails the build, not the page. [docs/ui-pages.md](docs/ui-pages.md) describes each screen.

- **Routes:** `/` opens the chat. `/avatars` (library), `/avatars/new` and `/avatars/:id` (one form for create and edit), `/chat` (a new session per page load or "New chat"; `/chat?avatar=<id>` opens it with that avatar picked), and `/how-it-works` (a diagram of the parts and one message traced through them). Any other path shows a not-found page.
- **Data:** TanStack Query for the avatar REST API. Mutations invalidate the list, and so does an answer from a newly created avatar.
- **Forms:** React Hook Form with the generated Zod schemas, so the browser and the API apply the same rules.
- **Chat streaming:** `EventSource` only supports GET, and sending a message is a POST. The client calls `fetch` and parses the `text/event-stream` body itself, handling the `avatar`, `stage`, `draft`, `evaluation`, `delta`, `done`, and `error` events. The draft is shown as thinking, the stage as a line of status, and the evaluation as the `validated` tag. An answer can be stopped while it is arriving. Answers are rendered as Markdown (`react-markdown`), without raw HTML.
- **Errors:** `application/problem+json` responses are shown by their `detail` field, with field errors placed next to the matching input. A failure with no problem document, such as a proxy's error page, is shown as a plain sentence, never as markup.
- **Assistant status:** the top bar shows the model in use, or that the assistant needs setup, from `GET /assistant`.
- **Styling:** one stylesheet (`apps/web/src/styles.css`) built on named colour, radius, and spacing tokens, with a dark and a light theme. The theme follows the system setting until the person switches it. Each avatar gets a colour gradient derived from its name. Fonts are Inter and Sora from Google Fonts. No CSS framework.

## Repo layout

```
contracts/                 OpenAPI specs (source of truth)
packages/contracts/        generated types, clients, Zod (do not edit; not committed)
apps/avatar-manager/       REST + SQLite, seed data
apps/avatar-mcp/           MCP server
apps/assistant/            loop, prompts, model adapters
apps/web/                  UI
Dockerfile                 demo image: all four processes, one port
docker-compose.yml         the one command
docker/                    nginx routing and the start script for the demo image
.env.example
```

## Configuration

Everything is configured through environment variables, read once at startup. A bad port or URL stops the service with a clear message. A missing or unusable model setting does not: the assistant starts and reports it.

| Variable | Used by | Example |
|---|---|---|
| `AUTOX_USERNAME` | assistant | Your AutoX user name. Sent as the `username` header |
| `AUTOX_KEY` | assistant | Your AutoX key. Sent as the `api-key` header |
| `LLM_MODEL` | assistant | `gpt-4.1-mini` (the default) |
| `ANSWER_CHECK` | assistant | `off` to show answers as they are written, unchecked. On by default |
| `LLM_TLS_VERIFY` | assistant | `false` skips checking the model provider's certificate. On by default; off in the container |
| `AUTOX_BASE_URL`, `AUTOX_API_VERSION`, `AUTOX_APPLICATION` | assistant | Rarely changed; defaults in [docs/LLM.md](docs/LLM.md) |
| `LLM_API_KEY`, `LLM_PROVIDER`, `LLM_BASE_URL` | assistant | Only for running on another provider; see [docs/LLM.md](docs/LLM.md) |
| `AVATAR_MCP_URL` | assistant | `http://localhost:3001/mcp` (set inside the demo image) |
| `AVATAR_API_URL` | avatar-mcp | `http://localhost:3000/v1` (set inside the demo image) |
| `DATABASE_PATH` | avatar-manager | `./data/avatars.db` |
| `CORS_ORIGIN` | avatar-manager, assistant | only when the UI is on another origin |
| `AVATARS_PORT` | docker compose | host port for the demo, default `8090` |

The assistant also reads a `.env` file at the project root. The avatar manager and the MCP server read the process environment only; their defaults suit local development.

Only the assistant reads the API key, and it is never sent to the browser, the MCP server, or the avatar manager. The demo container starts those two services without it in their environment, but one container is not an isolation boundary; in a real deployment only the assistant's image is given the key.

## Run

Copy `.env.example` to `.env`, set `AUTOX_USERNAME` and `AUTOX_KEY`, then:

```
pnpm install
pnpm start
```

Open `http://localhost:5173`. `pnpm start` generates the typed clients from `contracts/` and runs the four apps in watch mode on the ports in the Components table. The assistant is started with Node's `--use-system-ca`, so it trusts the certificate authorities the operating system trusts, which is what lets it reach AutoX on an Amdocs machine.

The same app also runs as one container:

```
docker/build-image.sh
docker compose up -d
```

Open `http://localhost:8090`. The SQLite file is on a named volume, so avatars survive a restart. Building the image needs the internet, which the Amdocs network reaches only through its proxy; `docker/build-image.sh` builds through the proxy in `HTTPS_PROXY` when one is set, using a separate build helper that has the proxy, and the plain way otherwise.

That image is for a demo only. It starts all four processes and publishes one port. nginx serves the UI and routes `/v1/avatars` to the avatar manager and `/v1/sessions` and `/v1/assistant` to the assistant; when a service cannot be reached it answers in the APIs' own error format. The container does not trust the Amdocs certificate authorities that AutoX's certificate is signed by, so `docker-compose.yml` sets `LLM_TLS_VERIFY=false`, which makes the assistant skip the certificate check on its calls to the model and nowhere else (`apps/assistant/src/tls.ts`). The start script waits for the three services, and stops the container if any process exits, so a failure is not silent. In a real deployment each component is its own image, with its own scaling and release, and the URLs between them are configuration.

Run locally, the web app is not on the same origin as the APIs, so it reads `VITE_AVATAR_API_URL` and `VITE_ASSISTANT_API_URL` (defaults: the local ports), and the two services allow the UI's origin through `CORS_ORIGIN`.

## Out of scope for v1

Authentication, multiple users, chats that survive a restart or can be reopened later, avatar versioning, search and paging.
