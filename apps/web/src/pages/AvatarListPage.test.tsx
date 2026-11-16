import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('avatar list', () => {
  it('shows an empty library and a New avatar control', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (new URL(url, 'http://localhost').pathname.endsWith('/avatars')) {
          return new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ type: 'about:blank', title: 'Not found', status: 404 }), {
          status: 404,
          headers: { 'content-type': 'application/problem+json' },
        });
      }),
    );

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/avatars']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('No avatars yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New avatar' })).toBeInTheDocument();
  });
});
