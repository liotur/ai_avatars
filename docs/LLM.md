# LLM configuration

Only the **assistant** holds the API key. The browser, avatar manager, and MCP server never see it.

## Environment variables

| Variable | Required | Notes |
|----------|----------|--------|
| `LLM_API_KEY` | Yes (for hosted providers) | Ollama local may omit auth |
| `LLM_PROVIDER` | No | If omitted, infer from key prefix when possible |
| `LLM_MODEL` | Sometimes | Required when the provider has no default |
| `LLM_BASE_URL` | Sometimes | Required for `custom` and some gateways |
| `LLM_USERNAME` | No | Gateways that need a user header (e.g. internal AI platforms) |

## Planned implementation

- **Runtime:** Vercel AI SDK (`ai`) for classification, answer generation, and streaming.
- **One model** for both the classify step and the answer step (no separate classifier model in v1).
- **Provider table:** a checked-in `llm-providers.json` (OpenAI-compatible chat completions) for base URLs, default models, auth headers, and key-prefix detection — same idea as an early spike in a local `avatar` prototype.

Supported provider ids in that table are expected to include at least: `openai`, `gemini`, `openrouter`, `ollama`, `custom`. Corporate gateways can be added as extra entries without changing the assistant loop.

## Startup behaviour

On boot the assistant loads `.env`, merges with process environment, validates with Zod, and fails fast with a clear message if the key, model, or base URL is missing.

## Demo container

`docker compose` injects `LLM_*` from the host `.env` into the assistant process only. Internal URLs (`AVATAR_MCP_URL`, etc.) are set inside the image for the all-in-one demo; see [ARCHITECTURE.md](../ARCHITECTURE.md).