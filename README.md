# ai_avatars

People define **avatars** — a stance an assistant can take when it answers (perspective, voice, what it cares about, what it ignores). The product lets you create and edit avatars in a library, then ask questions in chat; an assistant picks the avatar that fits, creates one when none fits, and answers in that voice.

Built for the Amdocs home assignment (avatar library + assistant that applies avatars).

## What is in the repo today

| Path | Purpose |
|------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Components, assistant loop, tech stack, deployment |
| [contracts/](./contracts/) | OpenAPI specs (avatar REST + assistant REST) |
| [docs/CONTRACTS.md](./docs/CONTRACTS.md) | How the public APIs and MCP tools relate |
| [docs/LLM.md](./docs/LLM.md) | Provider configuration for the assistant |

Implementation (apps, Docker, UI) follows these docs; see [ARCHITECTURE.md](./ARCHITECTURE.md) for the target layout.

## Components (summary)

```
Web UI
├─ Avatars — REST ──► Avatar manager (SQLite)
└─ Chat    — REST ──► Assistant ── MCP ──► Avatar MCP ── REST ──► Avatar manager
                      └── LLM provider
```

Four deployable pieces: **web**, **avatar-manager**, **avatar-mcp**, **assistant**. Each has one job; the assistant never talks to the database directly.

## Run (once implemented)

1. Copy `.env.example` to `.env`.
2. Set `LLM_API_KEY` (and `LLM_MODEL` if your provider has no default).
3. Start the demo stack:

   ```bash
   docker compose up --build
   ```

4. Open `http://localhost:8080`.

For local development without Docker, see **Run** in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Contracts

- **Avatar service** — CRUD for avatars (`contracts/avatar-service.openapi.yaml`).
- **Assistant** — sessions and streaming chat (`contracts/assistant.openapi.yaml`).
- **MCP** — `list_avatars`, `get_avatar`, `create_avatar` (thin wrapper over the avatar REST API); defined at implementation time, behaviour described in ARCHITECTURE.

## License

Private assignment repository unless stated otherwise.