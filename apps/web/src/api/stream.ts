import type { AvatarEvent, DeltaEvent, MessageRequest } from '@avatars/contracts/assistant';
import { zAvatarEvent, zDeltaEvent, zProblem } from '@avatars/contracts/assistant/zod';
import { assistantApiUrl } from './config';
import { ProblemError, problemFromResponse, type ProblemDetails } from './problem';

export type ChatStreamEvent =
  | { event: 'avatar'; data: AvatarEvent }
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
    const message = error instanceof Error ? error.message : 'The request could not be completed.';
    throw new ProblemError(undefined, message, 0);
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
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) emitBlock(block);
    }
  } catch (error) {
    if (signal?.aborted) return 'aborted';
    if (error instanceof ProblemError) throw error;
    const message = error instanceof Error ? error.message : 'The answer stopped before it finished.';
    throw new ProblemError(undefined, message, 0);
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
    throw new ProblemError(undefined, 'The assistant sent an unreadable event.', 200);
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
