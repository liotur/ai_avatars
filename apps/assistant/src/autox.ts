import type { AutoxLlm } from "./config.js";
import {
  createModel,
  isRecord,
  providerMessage,
  tryJson,
  type AssistantModel,
  type ModelOptions,
  type SseEvent,
  type StreamStep,
  type Wire,
} from "./model.js";

// In the Responses API, text the model wrote earlier is "output_text"; everything else is "input_text".
type InputItem =
  | { role: "system" | "user"; content: [{ type: "input_text"; text: string }] }
  | { role: "assistant"; content: [{ type: "output_text"; text: string }] };

/**
 * Amdocs AutoX speaks the OpenAI Responses API with its own headers:
 * `POST {base}/responses?api-version=`, authenticated by `api-key`,
 * `username`, and `application` instead of `Authorization: Bearer`.
 */
export function createAutoxModel(
  llm: AutoxLlm,
  fetchImpl: typeof fetch = fetch,
  options: ModelOptions = {},
): AssistantModel {
  return createModel(autoxWire(llm), fetchImpl, options);
}

function autoxWire(llm: AutoxLlm): Wire {
  return {
    url: responsesUrl(llm),
    headers: autoxHeaders(llm),
    secret: llm.key,
    keySetting: "AUTOX_KEY",
    label: llm.label,
    body: (system, messages, stream, temperature) => ({
      model: llm.model,
      ...(stream ? { stream: true } : {}),
      ...(temperature === undefined ? {} : { temperature }),
      input: [inputItem("system", system), ...messages.map((message) => inputItem(message.role, message.content))],
    }),
    textOf: extractOutputText,
    step: responsesStep,
  };
}

export function responsesUrl(llm: Pick<AutoxLlm, "baseUrl" | "apiVersion">): string {
  const base = llm.baseUrl.replace(/\/+$/, "");
  return `${base}/responses?api-version=${encodeURIComponent(llm.apiVersion)}`;
}

export function autoxHeaders(llm: Pick<AutoxLlm, "key" | "username" | "application">): Record<string, string> {
  return {
    "api-key": llm.key,
    username: llm.username,
    application: llm.application,
    "content-type": "application/json",
  };
}

function inputItem(role: "system" | "user" | "assistant", text: string): InputItem {
  if (role === "assistant") return { role, content: [{ type: "output_text", text }] };
  return { role, content: [{ type: "input_text", text }] };
}

export function extractOutputText(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return "";
  const parts: string[] = [];
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.join("");
}

/** One event of a Responses API stream. */
function responsesStep(event: SseEvent): StreamStep {
  if (event.data === "[DONE]") return { done: true };
  const payload = tryJson(event.data);
  const record = isRecord(payload) ? payload : undefined;
  const type = event.event ?? (typeof record?.type === "string" ? record.type : undefined);
  if (type === "error" || type === "response.failed") {
    const message = providerMessage(record);
    return { failed: message ? { message } : {} };
  }
  if (type === "response.incomplete") {
    const details = isRecord(record?.response) ? record.response.incomplete_details : undefined;
    const reason = isRecord(details) && typeof details.reason === "string" ? details.reason : undefined;
    return { incomplete: reason ? { reason } : {} };
  }
  if (type === "response.completed") return { done: true };
  if (type === "response.output_text.delta" && typeof record?.delta === "string" && record.delta.length > 0) {
    return { text: record.delta };
  }
  return {};
}
