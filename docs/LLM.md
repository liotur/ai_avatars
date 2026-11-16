# Language model configuration

The assistant calls **Amdocs AutoX**. Only the assistant reads the key. It is never sent to the browser, the avatar manager, or the MCP server, and it is removed from every error message and log line. (The demo container runs all the services together, so it is not an isolation boundary; in a real deployment only the assistant's image is given the key.)

## What to set

Three things, in `.env` at the project root (copy `.env.example`):

```
AUTOX_USERNAME=your-user-name
AUTOX_KEY=your-key
LLM_MODEL=gpt-4.1-mini
```

`LLM_MODEL` already has a default. `.env.example` lists other models in comments; use one your AutoX account offers. One model does all three calls: choosing the avatar, writing the answer, and checking it.

After changing `.env`, start the app again (stop it and `pnpm start`, or `docker compose up -d` for the container).

## What AutoX needs around it

- **The Amdocs network.** AutoX answers only on the VPN.
- **Trust in AutoX's certificate.** It is signed by an Amdocs authority that a stock Linux image and a stock Node do not know. Without that trust a message fails with "Could not reach the provider", although the network is fine.
  - `pnpm start`: the assistant is started with Node's `--use-system-ca`, so it trusts whatever the operating system trusts, and an Amdocs machine trusts the Amdocs authorities. The certificate is checked. That needs Node 22.15 or later.
  - Docker: the container trusts no Amdocs authority, so `docker-compose.yml` sets `LLM_TLS_VERIFY=false` and the assistant skips the certificate check on its calls to the model, and only there (`apps/assistant/src/tls.ts`). The connection is still encrypted, but a party able to intercept it could read the requests, the key included, so keep it to a network you trust.
- **No web proxy for AutoX.** AutoX is an internal address. The assistant does not use `HTTPS_PROXY`, so nothing needs changing; a `curl` test from a shell that has a proxy set needs `--noproxy '*'`.

Building the container image is the opposite case: it needs the internet (Docker Hub, npm, Debian), which the Amdocs VPN reaches only through the company proxy. `docker/build-image.sh` builds through the proxy in `HTTPS_PROXY` when one is set.

## The request

AutoX speaks the OpenAI **Responses** API with its own headers:

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
    { "role": "system", "content": [{ "type": "input_text", "text": "..." }] },
    { "role": "user", "content": [{ "type": "input_text", "text": "..." }] }
  ]
}
```

Earlier answers of the same chat are sent as `"role": "assistant"` items whose content type is `output_text`. The two calls that return a decision (choosing the avatar, checking the draft) are sent with `"temperature": 0`, so the same message is routed the same way each time; a model that accepts only its default temperature is asked again without it. The answer is requested with `"stream": true`, and the text is taken from the `response.output_text.delta` events.

## Settings

| Variable | Meaning | Default |
|---|---|---|
| `AUTOX_USERNAME` | Sent as the `username` header | none; required |
| `AUTOX_KEY` | Sent as the `api-key` header | none; required |
| `LLM_MODEL` | The model | `gpt-4.1-mini` |
| `AUTOX_BASE_URL` | Where AutoX is served from | `https://chat.autox.corp.amdocs.azr/api/v1/proxy/openai` |
| `AUTOX_API_VERSION` | The `api-version` query parameter | `2025-03-01-preview` |
| `AUTOX_APPLICATION` | Sent as the `application` header | `autox-merged-ui` |
| `ANSWER_CHECK` | `off` skips the validation: the answer is shown as it is written, with no thinking step | on |
| `LLM_TLS_VERIFY` | `false` skips checking the model provider's certificate | on; `false` in the container |

`LLM_USERNAME`, then the shell's `USERNAME`, stand in for an empty `AUTOX_USERNAME`.

## When the model is not set up

The assistant starts anyway and logs the reason. `GET /v1/assistant` returns `{"ready": false, "detail": "..."}`, a message is refused with `503` and the same detail, and the chat page shows it. A wrong key shows up on the first message as `502`, naming the provider that refused it and the setting to check.

## Without AutoX

To run the project away from the Amdocs network, the assistant can call another provider that speaks OpenAI **chat completions** (`POST {base}/chat/completions`, `Authorization: Bearer {LLM_API_KEY}`). Leave `AUTOX_KEY` empty and set `LLM_API_KEY`; the provider is recognised from the start of the key.

| `LLM_PROVIDER` | Recognised from a key starting with | Default model | Also needs |
|---|---|---|---|
| `gemini` | `AIza` | `gemini-flash-latest` | — |
| `openai` | `sk-` | `gpt-4.1-mini` | — |
| `openrouter` | `sk-or-` | none | `LLM_MODEL` |
| `ollama` | not from a key (no key needed) | none | `LLM_PROVIDER=ollama`, `LLM_MODEL` |
| `custom` | not from a key | none | `LLM_PROVIDER=custom`, `LLM_BASE_URL`, `LLM_MODEL` |

`sk-or-` is checked before `sk-`. Any other key that starts with `sk-` is taken to be OpenAI's and would be sent there, so for another service with such keys set `LLM_PROVIDER=custom` with `LLM_BASE_URL` and `LLM_MODEL`. A key that starts with `sk-ant-` is not sent anywhere until the provider is named. `LLM_BASE_URL` overrides a provider's address and must start with `http://` or `https://`.

These routes share all their code with the AutoX route except the request format (`apps/assistant/src/chat.ts` and `autox.ts`; the shared part is `model.ts`). They are covered by tests against a stand-in provider, and have not been run against the real services from this project. AutoX has, with `gpt-4.1-mini`.
