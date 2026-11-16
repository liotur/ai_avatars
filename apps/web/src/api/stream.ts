import type {
  AvatarEvent,
  DeltaEvent,
  DraftEvent,
  EvaluationEvent,
  MessageRequest,
  StageEvent,
} from '@avatars/contracts/assistant';
import {
  zAvatarEvent,
  zDeltaEvent,
  zDraftEvent,
  zEvaluationEvent,
  zProblem,
  zStageEvent,
} from '@avatars/contracts/assistant/zod';
import { assistantApiUrl } from './config';
import { ProblemError, problemFromResponse, statusMessage, type ProblemDetails } from './problem';

export type ChatStreamEvent =
  | { event: 'avatar'; data: AvatarEvent }
  | { event: 'stage'; data: StageEvent }
  | { event: 'draft'; data: DraftEvent }
  | { event: 'evaluation'; data: EvaluationEvent }
  | { event: 'delta'; data: DeltaEvent }
  | { event: 'done' }
  | { event: 'error'; data: ProblemDetails };

/** The assistant no longer knows the session, usually because it restarted. */
export class SessionNotFoundError extends ProblemError {}

/** The requested avatar no longer exists. */
export class AvatarNotFoundError extends ProblemError {}

async function failedResponse(response: Response): Promise<ProblemError> {
  const text = await response.text();
  const error = await problemFromResponse(new Response(text, { status: response.status }));
  if (response.status !== 404) return error;
  let type: unknown;
  try {
    type = (JSON.parse(text) as { type?: unknown }).type;
  } catch {
    return error;
  }
  const problem = { type: String(type), title: error.message, status: 404, detail: error.detail };
  if (typeof type === 'string' && type.endsWith('/session-not-found')) {
    return new SessionNotFoundError(problem, error.detail, 404);
  }
  if (typeof type === 'string' && type.endsWith('/avatar-not-found')) {
    return new AvatarNotFoundError(problem, error.detail, 404);
  }
  return error;
}

export async function streamMessage(
  sessionId: string,
  body: MessageRequest,
  onEvent: (event: ChatStreamEvent) => void,
  options?: { signal?: AbortSignal; onOpen?: () => void },
): Promise<'complete' | 'aborted'> {
  const signal = options?.signal;
  let response: Response;
  try {
    response = await fetch(
      `${assistantApiUrl}/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: 'POST',
        headers: {
          accept: 'text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      },
    );
  } catch (error) {
    if (signal?.aborted) return 'aborted';
    throw new ProblemError(undefined, statusMessage(0), 0);
  }

  if (!response.ok) throw await failedResponse(response);
  if (!response.body) {
    throw new ProblemError(undefined, 'The assistant returned an empty response.', response.status);
  }

  options?.onOpen?.();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const emitBlock = (block: string) => {
    const parsed = parseSseBlock(block);
    if (parsed) onEvent(parsed);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // A line end can arrive as "\r" in one chunk and "\n" in the next, so a last "\r" waits for what follows.
      const held = buffer.endsWith('\r') ? '\r' : '';
      const blocks = buffer
        .slice(0, buffer.length - held.length)
        .replace(/\r\n?/g, '\n')
        .split('\n\n');
      buffer = (blocks.pop() ?? '') + held;
      for (const block of blocks) emitBlock(block);
    }
  } catch (error) {
    if (signal?.aborted) return 'aborted';
    if (error instanceof ProblemError) throw error;
    throw new ProblemError(undefined, 'The connection closed before the answer finished.', 0);
  }

  buffer += decoder.decode();
  if (buffer.trim()) emitBlock(buffer);
  return 'complete';
}

function parseSseBlock(block: string): ChatStreamEvent | null {
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  }

  if (dataLines.length === 0) return null;

  let json: unknown;
  try {
    json = JSON.parse(dataLines.join('\n'));
  } catch {
    // Only the events that carry the answer are worth failing it for.
    if (eventName === 'avatar' || eventName === 'delta' || eventName === 'error') {
      throw new ProblemError(undefined, 'The assistant sent an unreadable event.', 200);
    }
    return eventName === 'done' ? { event: 'done' } : null;
  }

  if (eventName === 'avatar') {
    const parsed = zAvatarEvent.safeParse(json);
    if (!parsed.success) {
      throw new ProblemError(undefined, 'The assistant sent an unreadable avatar event.', 200);
    }
    return { event: 'avatar', data: parsed.data };
  }

  if (eventName === 'delta') {
    const parsed = zDeltaEvent.safeParse(json);
    if (!parsed.success) {
      throw new ProblemError(undefined, 'The assistant sent an unreadable answer.', 200);
    }
    return { event: 'delta', data: parsed.data };
  }

  // A stage, a piece of the draft, or a check result that cannot be read is not
  // worth failing the answer for.
  if (eventName === 'draft') {
    const parsed = zDraftEvent.safeParse(json);
    return parsed.success ? { event: 'draft', data: parsed.data } : null;
  }

  if (eventName === 'stage') {
    const parsed = zStageEvent.safeParse(json);
    return parsed.success ? { event: 'stage', data: parsed.data } : null;
  }

  if (eventName === 'evaluation') {
    const parsed = zEvaluationEvent.safeParse(json);
    return parsed.success ? { event: 'evaluation', data: parsed.data } : null;
  }

  if (eventName === 'done') return { event: 'done' };

  if (eventName === 'error') {
    const parsed = zProblem.safeParse(json);
    if (!parsed.success) {
      throw new ProblemError(undefined, 'The assistant sent an unreadable error.', 200);
    }
    return { event: 'error', data: parsed.data };
  }

  return null;
}
