import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App';

// Stands in for a page with a fault, to see what the rest of the app does about it.
vi.mock('./pages/ChatPage', () => ({
  ChatPage: () => {
    throw new Error('This page is broken.');
  },
}));

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      const path = new URL(url, 'http://localhost').pathname;
      const body = path.endsWith('/assistant') ? { ready: true, model: 'test-model' } : { items: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('app routes', () => {
  it.each(['/avatar', '/avatars/3f0a8a52-6f43-4a53-9d0e-1b6f0c1c2a77/edit'])(
    'shows a not-found page at %s',
    async (path) => {
      stubFetch();
      renderAt(path);
      const main = within(screen.getByRole('main'));

      expect(await main.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
      expect(main.getByRole('link', { name: 'Back to avatars' })).toHaveAttribute('href', '/avatars');
      expect(document.title).toBe('Page not found');
    },
  );

  it('keeps the top bar when a page fails, and shows the next page that is opened', async () => {
    // React reports the caught error on the console. That is expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch();
    renderAt('/chat');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on this page.');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Library' }));
    expect(await screen.findByText('No avatars yet.')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong on this page.')).not.toBeInTheDocument();
  });
});
