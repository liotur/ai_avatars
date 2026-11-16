# ai_avatars

People define **avatars**: a stance an assistant can take when it answers (a perspective, a voice, what it cares about, what it ignores). You create and edit avatars in a library, then ask questions in chat. The assistant picks the avatar that fits, creates one when none fits, and answers as it.

Built for the Amdocs home assignment (avatar library + assistant that applies avatars).

## Run it

### You need

| | |
|---|---|
| **Node.js 22.15 or later** | `node -v` to check |
| **pnpm** | `npm install -g pnpm` |
| **The Amdocs VPN** | the language model (Amdocs AutoX) answers only on the Amdocs network |
| **Your AutoX user name and key** | two lines in a file, in step 2 |

### Three steps

**1. Get the code**

```bash
git clone https://github.com/liotur/ai_avatars.git
cd ai_avatars
cp .env.example .env
```

**2. Put your AutoX user name and key in `.env`**

```
AUTOX_USERNAME=your-user-name
AUTOX_KEY=your-key
```

Nothing else needs changing. The model has a default (`gpt-4.1-mini`); the file lists others in comments. `.env` is never committed.

**3. Install and start**

```bash
pnpm install
pnpm start
```

Open **http://localhost:5173**.

You land on the chat. Ask something, or open **Library** to see the nine avatars the app starts with. **How it works** shows the parts and follows one question through them.

To stop, press `Ctrl+C`. To start again later, `pnpm start` is enough.

### If something is off

| You see | Why | Do |
|---|---|---|
| "Assistant needs setup" in the top bar | `AUTOX_USERNAME` or `AUTOX_KEY` is empty | Fill both in `.env`, then stop and `pnpm start` again |
| "Could not reach the provider" | The VPN is off | Connect the VPN and send the message again |
| "Amdocs AutoX returned 401" | The key or the user name is wrong | Correct `.env`, then stop and `pnpm start` again |
| A port is already in use | Something else is on 3000, 3001, 3002, or 5173 | Stop it, then `pnpm start` again |

## What you can do

- **Chat** — ask a question. Leave the choice to the assistant, or pick an avatar yourself. Each answer names the avatar that gave it, says whether it was chosen, created, or requested, and gives the reason. The assistant remembers the conversation, so follow-up questions work; "New chat" starts over.
- **Validated answers** — you watch the avatar think. A second model call then validates the draft (does it answer the question, is it sound, does it follow the avatar's stance and voice), and a draft that fails is rewritten once before it counts as the answer.
- **Library** — create, open, edit, and delete avatars. Each avatar has a name, a description, a perspective, a voice, an ordered list of what it cares about, a list of what it ignores, the situations to use it in, and an intensity (how strongly it shapes an answer). An avatar the assistant creates is saved here, where you can edit it.
- **Starter avatars** — a new library has nine, from a plain Generalist to a Roast Master, a Software Engineer, a QA Tester, a Philosopher, and Future Me at 80. Ask them the same question to see what an avatar changes.
- **How it works** — a page in the app with a diagram of the parts and one question traced through them, step by step.

## How it is built

```
Web UI
├─ Library — REST ──► Avatar manager (SQLite)
└─ Chat    — REST ──► Assistant ── MCP ──► Avatar MCP ── REST ──► Avatar manager
                      └── language model (Amdocs AutoX)
```

Four parts, each with one job. The assistant owns the prompts and never touches the database. The avatar manager owns the data and knows nothing about language models. [ARCHITECTURE.md](./ARCHITECTURE.md) has the detail.

| Path | Purpose |
|------|---------|
| `apps/web` | The UI: chat, avatar library, and the How it works page |
| `apps/avatar-manager` | REST API and SQLite. The only writer of avatar data |
| `apps/avatar-mcp` | MCP server: three tools over the avatar REST API |
| `apps/assistant` | Sessions, prompts, the choose-or-create loop, the answer check, and the model calls |
| `contracts/` | OpenAPI specs: the source of truth for both REST APIs |
| `packages/contracts` | Types, clients, and Zod schemas generated from `contracts/` (not committed) |
| `docs/` | [Contracts](./docs/CONTRACTS.md), [the language model and its settings](./docs/LLM.md), [screens](./docs/ui-pages.md) |

`pnpm start` generates the typed clients from `contracts/` and runs the four parts in watch mode: the UI on 5173, the avatar manager on 3000, the avatar MCP server on 3001, and the assistant on 3002. Avatars are kept in `apps/avatar-manager/data/`.

```bash
pnpm test        # all tests
pnpm typecheck   # all type checks
```

## Optional: one container

The same app can run as a single Docker container. It is not needed to try the project.

```bash
docker compose up --build
```

Then open `http://localhost:8090`. Two things differ from the steps above:

- **Building needs the internet** (Docker Hub, npm, Debian), and the Amdocs network reaches it only through the company proxy. Build off the VPN, or give Docker the proxy first.
- **The container does not know the Amdocs certificate authorities**, which AutoX's certificate is signed by. Put them in `certs/` once ([certs/README.md](./certs/README.md) has the one command), or every message ends with "Could not reach the provider".

## License

Private assignment repository unless stated otherwise.
