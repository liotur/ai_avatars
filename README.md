# ai_avatars

People define **avatars**: a stance an assistant can take when it answers (a perspective, a voice, what it cares about, what it ignores). You create and edit avatars in a library, then ask questions in chat. The assistant picks the avatar that fits, creates one when none fits, and answers as it.

Built for the Amdocs home assignment (avatar library + assistant that applies avatars).

## Run

1. Copy `.env.example` to `.env` and fill in `AUTOX_USERNAME` and `AUTOX_KEY` (Amdocs AutoX). The model has a default; the file lists others in comments.
2. AutoX's certificate is signed by an Amdocs authority, so give those authorities to the container once. On a Mac that has them installed:

   ```bash
   security find-certificate -a -c "Amdocs" -p /Library/Keychains/System.keychain > certs/amdocs-ca.pem
   ```

3. Start the demo:

   ```bash
   docker compose up --build
   ```

4. Open `http://localhost:8090`.

Without a key the app still starts. The library works, and the chat page says what is missing.

AutoX answers on the Amdocs network (VPN) only, while building the image needs the internet. On a network that reaches the internet only through a proxy, give that proxy to Docker before building. [docs/LLM.md](./docs/LLM.md) has the details, and the way to use another provider when AutoX is out of reach.

Set `AVATARS_PORT` in `.env` to use another port. Avatars are stored in a Docker volume, so they survive a restart.

## What you can do

- **Library** — create, open, edit, and delete avatars. Each avatar has a name, a description, a perspective, a voice, an ordered list of what it cares about, a list of what it ignores, the situations to use it in, and an intensity (how strongly it shapes an answer).
- **Starter avatars** — a new library has nine, from a plain Generalist to a Roast Master, a Software Engineer, a QA Tester, a Philosopher, and Future Me at 80. Ask them the same question to see what an avatar changes.
- **Chat** — ask a question. Leave the choice to the assistant, or pick an avatar yourself. Each answer names the avatar that gave it, says whether it was chosen, created, or requested, and gives the reason. An avatar the assistant creates is saved to the library, where you can edit it. The assistant remembers the conversation, so you can ask follow-up questions; "New chat" starts over. Before you see an answer, a second model call checks the draft, and a draft that fails is rewritten once.
- **How it works** — a page in the app with a diagram of the parts and one question traced through them, step by step.

## Components

```
Web UI
├─ Library — REST ──► Avatar manager (SQLite)
└─ Chat    — REST ──► Assistant ── MCP ──► Avatar MCP ── REST ──► Avatar manager
                      └── language model provider
```

Four parts, each with one job. The assistant owns the prompts and never touches the database. The avatar manager owns the data and knows nothing about language models. [ARCHITECTURE.md](./ARCHITECTURE.md) has the detail.

| Path | Purpose |
|------|---------|
| `apps/web` | The UI: avatar library and chat |
| `apps/avatar-manager` | REST API and SQLite. The only writer of avatar data |
| `apps/avatar-mcp` | MCP server: three tools over the avatar REST API |
| `apps/assistant` | Sessions, prompts, the choose-or-create loop, and the model calls |
| `contracts/` | OpenAPI specs: the source of truth for both REST APIs |
| `packages/contracts` | Types, clients, and Zod schemas generated from `contracts/` (not committed) |
| `Dockerfile`, `docker-compose.yml`, `docker/` | The demo image: all four processes behind one port |
| `docs/` | [Contracts](./docs/CONTRACTS.md), [model providers](./docs/LLM.md), [screens](./docs/ui-pages.md) |

## Develop

Needs Node 22 or later and pnpm.

```bash
pnpm install
pnpm generate   # writes packages/contracts/src from contracts/
pnpm dev        # all four apps in watch mode
```

Then open `http://localhost:5173`. The services listen on 3000 (avatar manager), 3001 (avatar MCP), and 3002 (assistant). The assistant reads the same `.env` file at the project root.

```bash
pnpm test
pnpm typecheck
```

Run `pnpm generate` again after changing a file in `contracts/`.

## License

Private assignment repository unless stated otherwise.
