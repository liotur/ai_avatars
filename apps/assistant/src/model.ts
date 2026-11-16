import { classificationSchema, type Classification } from "./classify.js";
import type { Avatar } from "@avatars/contracts/avatar";

import type { ChatMessage, ClassifierTurn } from "./conversation.js";
import { evaluationSchema, type Evaluation } from "./evaluate.js";
import type { AvatarSummary } from "./mcp.js";
import { CLASSIFIER_SYSTEM, classifierUserPrompt, EVALUATOR_SYSTEM, evaluatorUserPrompt } from "./prompts.js";
import { redact } from "./redact.js";

export class LlmCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmCallError";
  }
}

/**
 * The model answered, but its reply cannot be used as a classification: it is
 * not JSON, or a field breaks a limit. Unlike a provider failure this is worth
 * one retry, and `message` tells the model what to correct.
 */
export class ClassificationRejectedError extends LlmCallError {
  constructor(message: string) {
    super(message);
    this.name = "ClassificationRejectedError";
  }
}

export type ClassifyInput = {
  content: string;
  summaries: readonly AvatarSummary[];
  /** The last few turns of the chat, so a follow-up can stay with the same avatar. */
  history?: readonly ClassifierTurn[];
  feedback?: string;
};

export type AnswerInput = {
  system: string;
  prompt: string;
  /** The earlier turns of the chat, oldest first. */
  history?: readonly ChatMessage[];
  /** Aborts the provider call, for example when the client disconnects. */
  signal?: AbortSignal;
};

export type EvaluateInput = {
  /** The avatar that wrote the draft. */
  avatar: Avatar;
  /** The person's message. */
  content: string;
  /** The last few turns of the chat, so a follow-up can be judged in context. */
  history?: readonly ClassifierTurn[];
  draft: string;
  /** Aborts the provider call, for example when the client disconnects. */
  signal?: AbortSignal;
};

export type ModelOptions = {
  /** Classification must finish, and the stream must send something, within this time. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;

/** The model calls the assistant makes. Every provider is used through this. */
export interface AssistantModel {
  /** Choose an avatar for a message, or draft a new one. */
  classify(input: ClassifyInput): Promise<Classification>;
  /** Write the answer, piece by piece. */
  streamAnswer(input: AnswerInput): AsyncIterable<string>;
  /** Check a draft answer before the person sees it. */
  evaluate(input: EvaluateInput): Promise<Evaluation>;
}

export type SseEvent = { event?: string; data: string };

/** What one event of a provider's answer stream means. */
export type StreamStep = {
  /** Text to append to the answer. */
  text?: string;
  /** The provider said the answer is complete. */
  done?: boolean;
  /** The provider reported a failure. */
  failed?: { message?: string };
  /** The provider stopped before the answer was complete. */
  incomplete?: { reason?: string };
};

/**
 * Everything that differs between provider protocols. The timeouts, error
 * wording, and stream handling in `createModel` are the same for all of them.
 */
export type Wire = {
  url: string;
  headers: Record<string, string>;
  /** Removed from every error message. */
  secret: string;
  /** The setting named when the provider answers 401 or 403, for example LLM_API_KEY. */
  keySetting: string;
  /** The provider's name, used in that same message so it is clear where the key was sent. */
  label: string;
  /**
   * The request body for a system prompt and a conversation that ends with the
   * person's message. `temperature` is set for the calls that return a decision.
   */
  body(system: string, messages: readonly ChatMessage[], stream: boolean, temperature?: number): unknown;
  /** The text of a complete, non-streamed reply. */
  textOf(payload: unknown): string;
  step(event: SseEvent): StreamStep;
};

export function createModel(wire: Wire, fetchImpl: typeof fetch = fetch, options: ModelOptions = {}): AssistantModel {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const seconds = timeoutMs / 1000;

  const post = async (body: unknown, signal: AbortSignal, timedOut: () => boolean): Promise<Response> => {
    try {
      return await fetchImpl(wire.url, { method: "POST", headers: wire.headers, body: JSON.stringify(body), signal });
    } catch (error) {
      if (timedOut()) throw new LlmCallError(`The provider did not respond within ${seconds} seconds.`);
      if (signal.aborted) throw error;
      throw new LlmCallError(`Could not reach the provider at ${new URL(wire.url).host}.`);
    }
  };

  /** One question to the model whose whole reply is a JSON object. */
  const askForJson = async (system: string, user: string, outer?: AbortSignal): Promise<unknown> => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = outer ? AbortSignal.any([timeout, outer]) : timeout;
    const timedOut = () => timeout.aborted && !outer?.aborted;
    const messages: ChatMessage[] = [{ role: "user", content: user }];
    // Temperature 0 makes a decision repeatable: the same message gets the same avatar.
    let response = await post(wire.body(system, messages, false, 0), signal, timedOut);
    if (response.status === 400 && /temperature/i.test(await response.clone().text())) {
      // Some models accept only their default temperature.
      response = await post(wire.body(system, messages, false), signal, timedOut);
    }
    if (!response.ok) throw await llmError(response, wire);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (timedOut()) throw new LlmCallError(`The provider did not respond within ${seconds} seconds.`);
      if (outer?.aborted) throw error;
      throw new LlmCallError("The provider returned a response that was not JSON.");
    }
    assertNoProviderError(payload, wire.secret);
    try {
      return parseJsonObject(wire.textOf(payload));
    } catch {
      throw new ClassificationRejectedError("The model did not return JSON.");
    }
  };

  return {
    async classify(input) {
      const json = await askForJson(CLASSIFIER_SYSTEM, classifierUserPrompt(input));
      const parsed = classificationSchema.safeParse(json);
      if (!parsed.success) {
        throw new ClassificationRejectedError(
          `The model returned a classification that does not match the expected shape. ${describeIssues(parsed.error.issues)}`,
        );
      }
      return parsed.data;
    },

    async evaluate(input) {
      const json = await askForJson(EVALUATOR_SYSTEM, evaluatorUserPrompt(input), input.signal);
      const parsed = evaluationSchema.safeParse(json);
      if (!parsed.success) {
        throw new LlmCallError(`The check returned a reply that could not be used. ${describeIssues(parsed.error.issues)}`);
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
        const messages: ChatMessage[] = [...(input.history ?? []), { role: "user", content: input.prompt }];
        const response = await post(wire.body(input.system, messages, true), signal, timedOut);
        if (!response.ok) throw await llmError(response, wire);
        if (!response.body) {
          throw new LlmCallError("The provider returned an empty stream.");
        }
        let completed = false;
        try {
          for await (const event of readSse(response.body)) {
            bump();
            const step = wire.step(event);
            if (step.failed) {
              throw new LlmCallError(redact(step.failed.message ?? "The answer stream failed.", wire.secret));
            }
            // Text that arrives with the last event is part of the answer, complete or not.
            if (step.text) yield step.text;
            if (step.incomplete) {
              const reason = step.incomplete.reason ? ` (${step.incomplete.reason})` : "";
              throw new LlmCallError(`The provider stopped the answer before it finished${reason}.`);
            }
            if (step.done) completed = true;
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

/** The first few schema problems as "field: what is wrong", short enough to send back to the model. */
export function describeIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): string {
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join(".") || "reply"}: ${issue.message}`)
    .join("; ");
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

/** The human-readable message inside a provider's error payload, when there is one. */
export function providerMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const error = payload.error;
  if (typeof error === "string" && error.trim()) return error;
  if (isRecord(error) && typeof error.message === "string" && error.message.trim()) return error.message;
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  return undefined;
}

async function llmError(response: Response, wire: Wire): Promise<LlmCallError> {
  let detail = `The provider returned ${response.status}.`;
  if (response.status === 401 || response.status === 403) {
    detail = `${wire.label} returned ${response.status}. Check ${wire.keySetting}, or set LLM_PROVIDER if the key belongs to another service.`;
  } else {
    try {
      const body = await response.text();
      const parsed = tryJson(body);
      // Some gateways wrap the error in a one-item array.
      const message = providerMessage(Array.isArray(parsed) ? parsed[0] : parsed);
      if (message) detail = `The provider returned ${response.status}. ${message}`;
    } catch {
      // The status is enough when the body cannot be read.
    }
  }
  return new LlmCallError(redact(detail, wire.secret));
}

export function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
