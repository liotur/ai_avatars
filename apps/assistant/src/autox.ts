import type { Config } from "./config.js";
import { classificationSchema, type Classification } from "./classify.js";
import { CLASSIFIER_SYSTEM, classifierUserPrompt } from "./prompts.js";
import type { AvatarSummary } from "./mcp.js";
import { redact } from "./redact.js";

export class LlmCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmCallError";
  }
}

export type ClassifyInput = {
  content: string;
  summaries: readonly AvatarSummary[];
  feedback?: string;
};

export type AnswerInput = {
  system: string;
  prompt: string;
  /** Aborts the provider call, for example when the client disconnects. */
  signal?: AbortSignal;
};

export type AutoxOptions = {
  /** Classification must finish, and the stream must send something, within this time. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;

export interface AssistantModel {
  classify(input: ClassifyInput): Promise<Classification>;
  streamAnswer(input: AnswerInput): AsyncIterable<string>;
}

type InputItem = {
  role: "system" | "user";
  content: [{ type: "input_text"; text: string }];
};

/**
 * Amdocs AutoX speaks the OpenAI Responses API.
 *
 * @ai-sdk/openai 4.0.118 cannot target it: every request sets
 * `Authorization: Bearer`, and the URL is `${baseURL}/responses` with no
 * query string, so `api-version` cannot be attached. This client calls
 * `POST {base}/responses?api-version=` with fetch instead.
 */
export function createAutoxModel(
  config: Config,
  fetchImpl: typeof fetch = fetch,
  options: AutoxOptions = {},
): AssistantModel {
  const url = responsesUrl(config);
  const headers = autoxHeaders(config);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const seconds = timeoutMs / 1000;

  const post = async (body: unknown, signal: AbortSignal, timedOut: () => boolean): Promise<Response> => {
    try {
      return await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    } catch (error) {
      if (timedOut()) throw new LlmCallError(`The provider did not respond within ${seconds} seconds.`);
      if (signal.aborted) throw error;
      throw new LlmCallError(`Could not reach the provider at ${new URL(url).host}.`);
    }
  };

  return {
    async classify(input) {
      const signal = AbortSignal.timeout(timeoutMs);
      const timedOut = () => signal.aborted;
      const response = await post(
        {
          model: config.llmModel,
          input: [
            inputItem("system", CLASSIFIER_SYSTEM),
            inputItem("user", classifierUserPrompt(input)),
          ],
        },
        signal,
        timedOut,
      );
      if (!response.ok) throw await llmError(response, config.autoxKey);
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        if (timedOut()) throw new LlmCallError(`The provider did not respond within ${seconds} seconds.`);
        throw new LlmCallError("The provider returned a response that was not JSON.");
      }
      assertNoProviderError(payload, config.autoxKey);
      const text = extractOutputText(payload);
      let json: unknown;
      try {
        json = parseJsonObject(text);
      } catch (error) {
        if (error instanceof LlmCallError) throw error;
        throw new LlmCallError("The model did not return JSON.");
      }
      const parsed = classificationSchema.safeParse(json);
      if (!parsed.success) {
        throw new LlmCallError("The model returned classification JSON that does not match the expected shape.");
      }
      return parsed.data;
    },

    async *streamAnswer(input) {
      const idle = new AbortController();
      let timer = setTimeout(() => idle.abort(), timeoutMs);
      const bump = () => {
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(), timeoutMs);
      };
      const signal = input.signal ? AbortSignal.any([idle.signal, input.signal]) : idle.signal;
      const timedOut = () => idle.signal.aborted && !input.signal?.aborted;
      try {
        const response = await post(
          {
            model: config.llmModel,
            stream: true,
            input: [inputItem("system", input.system), inputItem("user", input.prompt)],
          },
          signal,
          timedOut,
        );
        if (!response.ok) throw await llmError(response, config.autoxKey);
        if (!response.body) {
          throw new LlmCallError("The provider returned an empty stream.");
        }
        let completed = false;
        try {
          for await (const event of readSse(response.body)) {
            bump();
            if (event.data === "[DONE]") {
              completed = true;
              continue;
            }
            const payload = parseEventData(event.data);
            const type = event.event ?? (typeof payload?.type === "string" ? payload.type : undefined);
            if (type === "error" || type === "response.failed") {
              throw new LlmCallError(redact(providerMessage(payload) ?? "The answer stream failed.", config.autoxKey));
            }
            if (type === "response.incomplete") {
              const reason = payload?.incompleteReason ? ` (${payload.incompleteReason})` : "";
              throw new LlmCallError(`The provider stopped the answer before it finished${reason}.`);
            }
            if (type === "response.completed") {
              completed = true;
              continue;
            }
            if (type === "response.output_text.delta" && typeof payload?.delta === "string" && payload.delta.length > 0) {
              yield payload.delta;
            }
          }
        } catch (error) {
          if (error instanceof LlmCallError || input.signal?.aborted) throw error;
          if (timedOut()) {
            throw new LlmCallError(`The provider sent nothing for ${seconds} seconds, so the answer stopped.`);
          }
          throw new LlmCallError("The connection to the provider closed before the answer finished.");
        }
        if (!completed) {
          throw new LlmCallError("The provider ended the answer stream before it finished.");
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function responsesUrl(config: Pick<Config, "autoxBaseUrl" | "autoxApiVersion">): string {
  const base = config.autoxBaseUrl.replace(/\/+$/, "");
  return `${base}/responses?api-version=${encodeURIComponent(config.autoxApiVersion)}`;
}

export function autoxHeaders(config: Pick<Config, "autoxKey" | "autoxUsername" | "autoxApplication">): Record<string, string> {
  return {
    "api-key": config.autoxKey,
    username: config.autoxUsername,
    application: config.autoxApplication,
    "content-type": "application/json",
  };
}

function inputItem(role: "system" | "user", text: string): InputItem {
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

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const body = (fenced?.[1] ?? trimmed).trim();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1)) as unknown;
      } catch {
        throw new LlmCallError("The model did not return JSON.");
      }
    }
    throw new LlmCallError("The model did not return JSON.");
  }
}

function assertNoProviderError(payload: unknown, secret: string): void {
  if (!isRecord(payload) || payload.error == null) return;
  throw new LlmCallError(redact(providerMessage(payload) ?? "The language model call failed.", secret));
}

function providerMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const error = payload.error;
  if (typeof error === "string" && error.trim()) return error;
  if (isRecord(error) && typeof error.message === "string" && error.message.trim()) return error.message;
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  return undefined;
}

async function llmError(response: Response, secret: string): Promise<LlmCallError> {
  let detail = `The provider returned ${response.status}.`;
  if (response.status === 401 || response.status === 403) {
    detail = `The provider returned ${response.status}. Check AUTOX_KEY.`;
  } else {
    try {
      const body = await response.text();
      const message = providerMessage(tryJson(body));
      if (message) detail = `The provider returned ${response.status}. ${message}`;
    } catch {
      // The status is enough when the body cannot be read.
    }
  }
  return new LlmCallError(redact(detail, secret));
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

type SseEvent = { event?: string; data: string };

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = takeSseBlocks(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) yield event;
    }
    buffer += decoder.decode();
    const parsed = takeSseBlocks(`${buffer}\n\n`);
    for (const event of parsed.events) yield event;
  } finally {
    reader.releaseLock();
  }
}

function takeSseBlocks(buffer: string): { events: SseEvent[]; rest: string } {
  let held = "";
  let text = buffer;
  if (text.endsWith("\r")) {
    held = "\r";
    text = text.slice(0, -1);
  }
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = text.split("\n\n");
  const rest = (blocks.pop() ?? "") + held;
  const events: SseEvent[] = [];
  for (const block of blocks) {
    const event = parseSseBlock(block);
    if (event) events.push(event);
  }
  return { events, rest };
}

function parseSseBlock(block: string): SseEvent | undefined {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split(/\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
  }
  if (dataLines.length === 0) return undefined;
  return event ? { event, data: dataLines.join("\n") } : { data: dataLines.join("\n") };
}

function parseEventData(
  data: string,
): { type?: string; delta?: string; error?: unknown; message?: string; incompleteReason?: string } | undefined {
  const payload = tryJson(data);
  if (!isRecord(payload)) return undefined;
  const details = isRecord(payload.response) ? payload.response.incomplete_details : undefined;
  const incompleteReason = isRecord(details) && typeof details.reason === "string" ? details.reason : undefined;
  return {
    ...(typeof payload.type === "string" ? { type: payload.type } : {}),
    ...(typeof payload.delta === "string" ? { delta: payload.delta } : {}),
    ...(payload.error !== undefined ? { error: payload.error } : {}),
    ...(typeof payload.message === "string" ? { message: payload.message } : {}),
    ...(incompleteReason ? { incompleteReason } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
