import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';

const CFO = {
  id: '3f0a8a52-6f43-4a53-9d0e-1b6f0c1c2a77',
  name: 'Skeptical CFO',
  description: 'A finance chief who funds only plans with numbers.',
  intensity: 'balanced',
  createdBy: 'user',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
}

function sse(events: Array<[string, unknown]>): Response {
  const text = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const answer = (): Response =>
  sse([
    ['avatar', { avatar: CFO, selection: { mode: 'chosen', reason: 'A budget question.' } }],
    ['delta', { text: 'Show me ' }],
    ['delta', { text: 'the payback.' }],
    ['done', { id: '5d1c7b8e-0f2a-4c3b-9e8d-7a6b5c4d3e2f', createdAt: '2026-11-16T11:02:00Z' }],
  ]);

type Handler = (path: string, init?: RequestInit) => Response | Promise<Response>;

function stubFetch(onMessage: Handler) {
  let sessions = 0;
  const messagePaths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : (init?.method ?? 'GET');
      const path = new URL(url, 'http://localhost').pathname;
      if (path.endsWith('/avatars')) return json({ items: [] });
      if (method === 'POST' && path.endsWith('/sessions')) {
        sessions += 1;
        return json({ id: `0000000${sessions}-0000-4000-8000-000000000000`, createdAt: '2026-11-16T11:00:00Z' }, 201);
      }
      if (path.endsWith('/messages')) {
        messagePaths.push(path);
        return onMessage(path, init);
      }
      return json({ type: 'about:blank', title: 'Not found', status: 404 }, 404, 'application/problem+json');
    }),
  );
  return { sessions: () => sessions, messagePaths };
}

function renderChat(path = '/chat') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function typeMessage(text: string) {
  const box = await screen.findByLabelText('Ask something');
  await waitFor(() => expect(box).toBeEnabled());
  fireEvent.change(box, { target: { value: text } });
  return box;
}

describe('chat', () => {
  it('is the page the app opens on', async () => {
    stubFetch(() => answer());
    renderChat('/');
    expect(await screen.findByLabelText('Ask something')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('aria-current', 'page');
  });

  it('sends on Enter and keeps Shift+Enter for a new line', async () => {
    stubFetch(() => answer());
    renderChat();
    const box = await typeMessage('Should we hire?');
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(document.querySelectorAll('ol.thread > li')).toHaveLength(0);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText('Show me the payback.')).toBeInTheDocument();
    expect(screen.getByText('chosen')).toBeInTheDocument();
  });

  it('says the answer was validated, and keeps a rejected first draft behind a toggle', async () => {
    const validated = (draft: string, evaluation: unknown, answerText: string) =>
      sse([
        ['avatar', { avatar: CFO, selection: { mode: 'chosen', reason: 'A budget question.' } }],
        ['stage', { stage: 'drafting' }],
        ['draft', { text: draft }],
        ['stage', { stage: 'checking' }],
        ['evaluation', evaluation],
        ['delta', { text: answerText }],
        ['done', { id: '5d1c7b8e-0f2a-4c3b-9e8d-7a6b5c4d3e2f', createdAt: '2026-11-16T11:02:00Z' }],
      ]);
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls === 1
        ? validated('Show me the payback.', { verdict: 'passed', failed: [] }, 'Show me the payback.')
        : validated(
            'Follow your dreams.',
            { verdict: 'revised', failed: ['stance'], note: 'Lead with the cash runway.' },
            'Runway first: nine months.',
          );
    });
    renderChat();

    await typeMessage('Should we hire?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    // A draft that passed is shown once, as the answer, with nothing left of the thinking block.
    expect(await screen.findByText('validated')).toBeInTheDocument();
    expect(screen.getAllByText('Show me the payback.')).toHaveLength(1);
    expect(document.querySelector('.thinking')).toBeNull();
    expect(document.querySelector('.first-draft')).toBeNull();

    await typeMessage('And now?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('rewritten after validation')).toBeInTheDocument();
    expect(screen.getByText('Runway first: nine months.')).toBeInTheDocument();
    expect(
      screen.getByText("The first draft did not follow the avatar's stance. Lead with the cash runway."),
    ).toBeInTheDocument();
    // The rejected draft is kept, out of the way.
    const firstDraft = document.querySelector('details.first-draft');
    expect(firstDraft).not.toBeNull();
    expect(firstDraft).not.toHaveAttribute('open');
    expect(firstDraft?.textContent).toContain('Follow your dreams.');
  });

  it('shows the draft as thinking while it is written, then says it is being validated', async () => {
    const encoder = new TextEncoder();
    let push: (events: Array<[string, unknown]>) => void = () => {};
    let finish: () => void = () => {};
    stubFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              push = (events) => {
                for (const [event, data] of events) {
                  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
                }
              };
              finish = () => controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    renderChat();
    await typeMessage('Should we hire?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument());
    push([
      ['avatar', { avatar: CFO, selection: { mode: 'chosen', reason: 'A budget question.' } }],
      ['stage', { stage: 'drafting' }],
      ['draft', { text: 'Show me ' }],
    ]);
    expect(await screen.findByText('Thinking.')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.thinking')?.textContent).toBe('Show me'));

    push([
      ['draft', { text: 'the payback.' }],
      ['stage', { stage: 'checking' }],
    ]);
    expect(await screen.findByText('Validating the answer.')).toBeInTheDocument();
    expect(document.querySelector('.thinking')?.textContent).toBe('Show me the payback.');
    // Nothing counts as the answer yet.
    expect(screen.queryByText('validated')).not.toBeInTheDocument();

    push([
      ['evaluation', { verdict: 'passed', failed: [] }],
      ['delta', { text: 'Show me the payback.' }],
      ['done', { id: '5d1c7b8e-0f2a-4c3b-9e8d-7a6b5c4d3e2f', createdAt: '2026-11-16T11:02:00Z' }],
    ]);
    finish();
    expect(await screen.findByText('validated')).toBeInTheDocument();
    expect(document.querySelector('.thinking')).toBeNull();
    expect(screen.queryByText('Validating the answer.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('starts over with New chat: an empty thread and a new session', async () => {
    const fetchState = stubFetch(() => answer());
    renderChat();
    expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument();

    await typeMessage('Should we hire?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Show me the payback.')).toBeInTheDocument();
    expect(fetchState.sessions()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(document.querySelectorAll('ol.thread > li')).toHaveLength(0);
    await waitFor(() => expect(fetchState.sessions()).toBe(2));

    // The next message goes to the new session, which has no memory of the first.
    await typeMessage('And now?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetchState.messagePaths).toHaveLength(2));
    expect(fetchState.messagePaths[1]).toContain('00000002-');
  });

  it('opens a new session and resends when the old one is gone', async () => {
    const fetchState = stubFetch((path) =>
      path.includes('00000001-')
        ? json(
            {
              type: 'https://assistant.local/problems/session-not-found',
              title: 'Session not found',
              status: 404,
              detail: 'No session with id 00000001-0000-4000-8000-000000000000. Open a new one.',
            },
            404,
            'application/problem+json',
          )
        : answer(),
    );
    renderChat();
    await typeMessage('Should we hire?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Show me the payback.')).toBeInTheDocument();
    expect(screen.getByText('The assistant no longer had this chat, so it does not remember the earlier messages.')).toBeInTheDocument();
    expect(fetchState.sessions()).toBe(2);
    expect(fetchState.messagePaths).toHaveLength(2);
  });

  it('shows a failure before the stream above the composer and gives the text back', async () => {
    stubFetch(() =>
      json(
        { type: 'https://assistant.local/problems/llm-failed', title: 'Language model call failed', status: 502, detail: 'The provider returned 500.' },
        502,
        'application/problem+json',
      ),
    );
    renderChat();
    await typeMessage('Should we hire?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('The provider returned 500.')).toBeInTheDocument();
    expect(screen.getByLabelText('Ask something')).toHaveValue('Should we hire?');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(document.querySelectorAll('ol.thread > li')).toHaveLength(0);
  });

  it('opens the avatar of an answer in a new tab, so the chat stays', async () => {
    stubFetch(() => answer());
    renderChat();
    const box = await typeMessage('Should we hire?');
    fireEvent.keyDown(box, { key: 'Enter' });

    const link = await screen.findByRole('link', { name: /^Skeptical CFO/ });
    expect(link).toHaveTextContent('Skeptical CFO (opens in a new tab)');
    expect(link).toHaveAttribute('href', `/avatars/${CFO.id}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('works on an address where the browser has no crypto.randomUUID', async () => {
    vi.stubGlobal('crypto', {});
    stubFetch(() => answer());
    renderChat();
    const box = await typeMessage('Should we hire?');
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(await screen.findByText('Show me the payback.')).toBeInTheDocument();
  });

  it('puts an example question in the message box', async () => {
    stubFetch(() => answer());
    renderChat();
    const example = await screen.findByRole('button', { name: 'Explain how vaccines work to a curious ten-year-old.' });
    await waitFor(() => expect(example).toBeEnabled());
    fireEvent.click(example);

    expect(screen.getByLabelText('Ask something')).toHaveValue('Explain how vaccines work to a curious ten-year-old.');
  });
});
