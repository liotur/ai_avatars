# LLM configuration

Only the **assistant** holds the API key. The browser, avatar manager, and MCP server never see it.

This project calls the Amdocs AutoX proxy. The protocol is the OpenAI **Responses** API, not chat completions.

```
POST {AUTOX_BASE_URL}/responses?api-version={AUTOX_API_VERSION}
api-key: {AUTOX_KEY}
username: {AUTOX_USERNAME}
application: {AUTOX_APPLICATION}
Content-Type: application/json
```

```json
{
  "model": "gpt-4.1-mini",
  "input": [
    { "role": "user", "content": [{ "type": "input_text", "text": "ping" }] }
  ]
}
```

A system prompt is an `input` item with `"role": "system"` and the same `input_text` content. Streaming uses the Responses API stream, and the text shown to the user is taken from the output text deltas.

## Environment variables

| Variable | Required | Default |
|---|---|---|
| `LLM_PROVIDER` | yes | `autox` |
| `AUTOX_KEY` | yes | — |
| `AUTOX_USERNAME` | yes | — |
| `AUTOX_BASE_URL` | no | `https://chat.autox.corp.amdocs.azr/api/v1/proxy/openai` |
| `AUTOX_API_VERSION` | no | `2025-03-01-preview` |
| `AUTOX_APPLICATION` | no | `autox-merged-ui` |
| `LLM_MODEL` | no | `gpt-4.1-mini` |

`LLM_API_KEY` is accepted as a fallback for `AUTOX_KEY`. `USERNAME` is accepted as a fallback for `AUTOX_USERNAME`, so an existing shell export keeps working. Empty `AUTOX_*` values fall through to those aliases. The key is never logged.

One model does both the classification call and the answer. There is no separate classifier model.

## Startup

The assistant reads the process environment (and a local `.env` when one exists), checks the values with Zod, and refuses to start if the key, username, base URL, or model is missing.
