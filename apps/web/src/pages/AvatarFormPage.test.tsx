import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';

type Handler = (method: string, path: string) => Response | undefined;

function problem(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title: 'Problem', status, ...body }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

function stubFetch(handler: Handler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    return handler(request.method, path) ?? problem(404, { detail: 'Not found.' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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

function fillRequired(name: string) {
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'd' } });
  fireEvent.change(screen.getByLabelText(/^Perspective/), { target: { value: 'p' } });
  fireEvent.change(screen.getByLabelText(/^Voice/), { target: { value: 'v' } });
  fireEvent.change(screen.getByLabelText('Cares about 1'), { target: { value: 'Cash' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('avatar form', () => {
  it('says the name is already used under Name on a 409', async () => {
    stubFetch((method, path) =>
      method === 'POST' && path.endsWith('/avatars')
        ? problem(409, { detail: 'An avatar named "generalist" already exists.' })
        : undefined,
    );
    renderAt('/avatars/new');
    fillRequired('generalist');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const error = await screen.findByText('That name is already used.');
    expect(error.closest('.field')).toContainElement(screen.getByLabelText(/^Name/));
  });

  it('flags a repeated list item before sending anything', async () => {
    const fetchMock = stubFetch(() => undefined);
    renderAt('/avatars/new');
    fillRequired('Unique');
    const add = screen.getByLabelText('Add to Cares about');
    fireEvent.change(add, { target: { value: ' Cash ' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const error = await screen.findByText('Already in this list.');
    expect(error.closest('li')).toContainElement(screen.getByLabelText('Cares about 2'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a not-found state for a missing or malformed id', async () => {
    const fetchMock = stubFetch(() => undefined);
    renderAt('/avatars/3f0a8a52-6f43-4a53-9d0e-1b6f0c1c2a77');
    expect(await screen.findByRole('heading', { name: 'Avatar not found' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not request an id that is not a uuid', async () => {
    const fetchMock = stubFetch(() => undefined);
    renderAt('/avatars/not-a-uuid');
    expect(await screen.findByRole('heading', { name: 'Avatar not found' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Back to avatars' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
