# Contracts

The OpenAPI files under `contracts/` are the source of truth for HTTP APIs. Generated TypeScript types, clients, and Zod schemas will live in `packages/contracts/` once the monorepo is scaffolded.

## Avatar service (`/v1`)

| Operation | Path | Use |
|-----------|------|-----|
| `listAvatars` | `GET /avatars` | UI library; MCP projects to summaries for classification |
| `createAvatar` | `POST /avatars` | UI create; assistant when proposing a new avatar |
| `getAvatar` | `GET /avatars/{id}` | UI detail; assistant before answering |
| `updateAvatar` | `PATCH /avatars/{id}` | UI edit only |
| `deleteAvatar` | `DELETE /avatars/{id}` | UI delete only |
| `getHealth` | `GET /health` | Liveness |

Errors use `application/problem+json` (RFC 9457). Avatar names are unique case-insensitively.

## Assistant (`/v1`)

| Operation | Path | Use |
|-----------|------|-----|
| `createSession` | `POST /sessions` | UI opens one chat tab |
| `sendMessage` | `POST /sessions/{id}/messages` | User message in; streamed answer out |
| `getHealth` | `GET /health` | Liveness |

### Streaming response

`sendMessage` returns `text/event-stream` after classification and avatar resolution succeed:

1. `avatar` — who is answering and how they were chosen (`requested` | `chosen` | `created`).
2. `delta` — answer text chunks.
3. `done` — message id and timestamp.

Failures before the stream opens are normal HTTP errors (400, 404, 502).

### What is not in the public contract

How the model **classifies** (pick existing id vs draft a new avatar) is internal to the assistant: prompts and a structured-output schema in code, not in OpenAPI.

## MCP tools (avatar-mcp)

| Tool | Maps to |
|------|---------|
| `list_avatars` | `GET /avatars` → summary fields only |
| `get_avatar` | `GET /avatars/{id}` |
| `create_avatar` | `POST /avatars` (`createdBy: assistant` when the assistant saves a draft) |

The assistant calls MCP only, not the avatar REST API. The web UI calls REST only, not MCP.