# Contracts

The OpenAPI files under `contracts/` are the source of truth for the two HTTP APIs. `pnpm generate` turns them into TypeScript types, fetch clients, and Zod schemas under `packages/contracts/src`. That folder is not committed, so run `pnpm generate` after cloning and after changing a contract. The services validate requests with the generated schemas, and the web app calls the generated clients, so a contract change that the code does not follow fails the type check.

## Avatar service (`/v1`)

| Operation | Path | Use |
|-----------|------|-----|
| `listAvatars` | `GET /avatars` | UI library; MCP projects to summaries for classification |
| `createAvatar` | `POST /avatars` | UI create; assistant when it saves a new avatar |
| `getAvatar` | `GET /avatars/{id}` | UI detail; assistant before answering |
| `updateAvatar` | `PATCH /avatars/{id}` | UI edit only |
| `deleteAvatar` | `DELETE /avatars/{id}` | UI delete only |
| `getHealth` | `GET /health` | Liveness |

Errors use `application/problem+json` (RFC 9457). Avatar names are unique without regard to letter case.

## Assistant (`/v1`)

| Operation | Path | Use |
|-----------|------|-----|
| `getAssistantStatus` | `GET /assistant` | Whether a language model is configured, and which one |
| `createSession` | `POST /sessions` | The UI opens one chat. The assistant remembers its turns in memory |
| `sendMessage` | `POST /sessions/{id}/messages` | A message in; a streamed answer out |
| `getHealth` | `GET /health` | Liveness |

### Streaming response

`sendMessage` returns `text/event-stream` once the avatar is settled:

1. `avatar` — who is answering and how they were picked (`requested` | `chosen` | `created`), with the reason.
2. `stage` — what the assistant is doing (`drafting` | `checking` | `revising`).
3. `draft` — the draft as it is written. Work in progress, shown as thinking; not the answer.
4. `evaluation` — how the check of the draft went (`passed` | `revised` | `skipped`), which checks failed, and the checker's note.
5. `delta` — the answer text: the whole draft in one piece when it passed, the rewrite in pieces when it did not.
6. `done` — the answer's id and time.

`stage`, `draft`, and `evaluation` are sent only when answers are checked, which is the default. A client that reads only `delta` shows checked text only.

If the answer fails after the stream has opened, an `error` event (a problem document) is sent instead of `done`.

Failures before the stream opens are ordinary HTTP errors:

| Status | Meaning |
|---|---|
| 400 | The request does not match the contract |
| 404 | The session, or the requested avatar, does not exist |
| 502 | The language model or the avatar MCP server failed, or the model's classification was unusable after one retry |
| 503 | No language model is configured. `GET /assistant` reports the same state |

### What is not in the public contract

How the assistant **classifies** (choose an existing avatar or draft a new one) and how it **checks** a draft are internal to it: the prompts and the shape of the model's replies live in `apps/assistant/src`, not in OpenAPI.

## MCP tools (avatar-mcp)

| Tool | Maps to |
|------|---------|
| `list_avatars` | `GET /avatars`, summary fields only (`id`, `name`, `description`, `useWhen`) |
| `get_avatar` | `GET /avatars/{id}` |
| `create_avatar` | `POST /avatars` (the assistant sets `createdBy: assistant`) |

There is no update or delete tool: editing stays with people. The tool input schemas in `apps/avatar-mcp/src/schemas` are written by hand to mirror the avatar contract, with descriptions for the model; change them together with the contract.

The assistant calls MCP only, not the avatar REST API. The web UI calls REST only, not MCP.
