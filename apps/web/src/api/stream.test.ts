import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamMessage, type ChatStreamEvent } from './stream';

const SESSION = '00000001-0000-4000-8000-000000000000';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** An event stream that arrives in exactly these pieces. */
function chunked(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function read(chunks: string[]): Promise<ChatStreamEvent[]> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => chunked(chunks)),
  );
  const events: ChatStreamEvent[] = [];
  const result = await streamMessage(SESSION, { content: 'Should we hire?' }, (event) => events.push(event));
  expect(result).toBe('complete');
  return events;
}

describe('streamMessage', () => {
  it('delivers an event once when its CRLF is split between two chunks', async () => {
    const events = await read(['event: delta\r', '\ndata: {"text":"Show me "}\r\n\r\n']);
    expect(events).toEqual([{ event: 'delta', data: { text: 'Show me ' } }]);
  });

  it('reads the same events wherever a CRLF stream is cut', async () => {
    const text = [
      'event: delta\r\ndata: {"text":"Show me "}\r\n\r\n',
      'event: delta\r\ndata: {"text":"the payback."}\r\n\r\n',
      'event: done\r\ndata: {"id":"5d1c7b8e-0f2a-4c3b-9e8d-7a6b5c4d3e2f"}\r\n\r\n',
    ].join('');
    const expected: ChatStreamEvent[] = [
      { event: 'delta', data: { text: 'Show me ' } },
      { event: 'delta', data: { text: 'the payback.' } },
      { event: 'done' },
    ];
    expect(await read([text])).toEqual(expected);
    for (let cut = 1; cut < text.length; cut += 1) {
      expect(await read([text.slice(0, cut), text.slice(cut)]), `cut at ${cut}`).toEqual(expected);
    }
  });

  it('still reads a stream that ends its lines with LF only', async () => {
    const events = await read(['event: delta\ndata: {"text":"Show me "}\n', '\nevent: done\ndata: {}\n\n']);
    expect(events).toEqual([{ event: 'delta', data: { text: 'Show me ' } }, { event: 'done' }]);
  });

  it('reads the stage, draft and check events, and skips one it cannot read instead of failing the answer', async () => {
    const events = await read([
      'event: draft\ndata: {"text":"Hi"}\n\n',
      'event: draft\ndata: {"text":""}\n\n',
      'event: stage\ndata: {"stage":"checking"}\n\n',
      'event: evaluation\ndata: {"verdict":"revised","failed":["voice"],"note":"Speak plainly."}\n\n',
      'event: stage\ndata: {"stage":"something new"}\n\n',
      'event: delta\ndata: {"text":"Hi"}\n\n',
      'event: done\ndata: {"id":"5d1c7b8e-0f2a-4c3b-9e8d-7a6b5c4d3e2f","createdAt":"2026-11-16T11:02:00Z"}\n\n',
    ]);
    expect(events).toEqual([
      { event: 'draft', data: { text: 'Hi' } },
      { event: 'stage', data: { stage: 'checking' } },
      { event: 'evaluation', data: { verdict: 'revised', failed: ['voice'], note: 'Speak plainly.' } },
      { event: 'delta', data: { text: 'Hi' } },
      { event: 'done' },
    ]);
  });
});
