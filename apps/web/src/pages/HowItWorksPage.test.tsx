import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ready: true, model: 'test-model' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/how-it-works']}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('how it works', () => {
  it('is reachable from the top bar and marks itself as the current page', () => {
    renderPage();
    const link = within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'How it works' });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Four parts, one job each' })).toBeInTheDocument();
  });

  it('describes the diagram in words for people who cannot see it', () => {
    renderPage();
    const caption = document.querySelector('.diagram figcaption');
    expect(caption?.textContent).toContain('The assistant calls the avatar MCP server with MCP tools');
    expect(caption?.textContent).toContain('The assistant calls the language model over HTTPS');
    // The drawings themselves are hidden from assistive technology.
    for (const drawing of document.querySelectorAll('.diagram svg')) {
      expect(drawing).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('walks one question through seven steps, naming each tool, check and event', () => {
    renderPage();
    const steps = document.querySelectorAll('ol.flow > li');
    expect(steps).toHaveLength(7);
    const flow = document.querySelector('ol.flow') as HTMLElement;
    for (const text of ['list_avatars', 'get_avatar', 'create_avatar', 'requested', 'chosen', 'created', 'answers', 'sound', 'stance', 'voice', 'checked', 'evaluation', 'done']) {
      expect(within(flow).getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('link', { name: 'Try it in chat' })).toHaveAttribute('href', '/chat');
  });
});
