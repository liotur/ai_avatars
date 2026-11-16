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

function renderChat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/chat']}>
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
    expect(screen.getByText('The assistant restarted, so a new chat was opened.')).toBeInTheDocument();
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
});
