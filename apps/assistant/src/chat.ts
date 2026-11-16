import type { ChatLlm } from "./config.js";
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

/**
 * Any provider that speaks the OpenAI chat-completions protocol:
 * Gemini, OpenAI, OpenRouter, the amAIz gateway, Ollama, or a custom endpoint.
 * They differ only in address, headers, and model name, which `ChatLlm` holds.
 */
export function createChatModel(
  llm: ChatLlm,
  fetchImpl: typeof fetch = fetch,
  options: ModelOptions = {},
): AssistantModel {
  return createModel(chatWire(llm), fetchImpl, options);
}

function chatWire(llm: ChatLlm): Wire {
  return {
    url: chatCompletionsUrl(llm),
    headers: llm.headers,
    secret: llm.key,
    keySetting: "LLM_API_KEY",
    label: llm.label,
    body: (system, messages, stream, temperature) => ({
      model: llm.model,
      ...(stream ? { stream: true } : {}),
      ...(temperature === undefined ? {} : { temperature }),
      messages: [{ role: "system", content: system }, ...messages],
    }),
    textOf: extractMessageText,
    step: chatStep,
  };
}

export function chatCompletionsUrl(llm: Pick<ChatLlm, "baseUrl">): string {
  return `${llm.baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/** The reply text of a complete chat completion. Content is a string, or a list of text parts. */
export function extractMessageText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return "";
  const choice: unknown = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return "";
  return textOfContent(choice.message.content);
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (isRecord(part) && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("");
}

/** Finish reasons that mean the answer was cut short, not finished. */
const CUT_SHORT = new Set(["length", "max_tokens", "content_filter", "error"]);

/**
 * One event of a chat-completions stream. The answer is complete at
 * `data: [DONE]` or at the chunk that carries a `finish_reason`, since some
 * gateways send only one of the two. A reason in CUT_SHORT means the provider
 * stopped early. Reasoning text is not part of the answer.
 */
function chatStep(event: SseEvent): StreamStep {
  if (event.data === "[DONE]") return { done: true };
  const payload = tryJson(event.data);
  if (!isRecord(payload)) return {};
  if (payload.error != null) {
    const message = providerMessage(payload);
    return { failed: message ? { message } : {} };
  }
  const choice: unknown = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  if (!isRecord(choice)) return {};

  const text = isRecord(choice.delta) ? textOfContent(choice.delta.content) : "";
  const finish = typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
  if (finish && CUT_SHORT.has(finish.toLowerCase())) {
    return { ...(text ? { text } : {}), incomplete: { reason: finish } };
  }
  return { ...(text ? { text } : {}), ...(finish ? { done: true } : {}) };
}
