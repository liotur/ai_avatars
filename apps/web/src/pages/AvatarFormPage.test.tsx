import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

/**
 * Returns a mock that records requests to the avatar API only. The page frame
 * also asks the assistant for its status, which these tests do not count.
 */
function stubFetch(handler: Handler) {
  const avatarApi = vi.fn(
    (method: string, path: string) => handler(method, path) ?? problem(404, { detail: 'Not found.' }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      if (path.endsWith('/assistant')) {
        return new Response(JSON.stringify({ ready: true, provider: 'test', model: 'test-model' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return avatarApi(request.method, path);
    }),
  );
  return avatarApi;
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

const SAVED = {
  id: '3f0a8a52-6f43-4a53-9d0e-1b6f0c1c2a77',
  name: 'Skeptical CFO',
  description: 'A finance chief who funds only plans with numbers.',
  perspective: 'Reads every proposal as a claim on cash.',
  voice: 'Dry and brief.',
  caresAbout: ['Cash runway'],
  ignores: [],
  useWhen: [],
  intensity: 'balanced',
  createdBy: 'user',
  createdAt: '2026-11-16T11:00:00Z',
  updatedAt: '2026-11-16T11:00:00Z',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Lets validation or a save that an event started run to its end. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** jsdom does not submit a form on Enter, so this does what a browser does when the key is not handled. */
function pressEnter(input: HTMLElement) {
  const unhandled = fireEvent.keyDown(input, { key: 'Enter' });
  const form = input.closest('form');
  if (unhandled && form) fireEvent.submit(form);
}

function addCaresAbout(text: string) {
  const add = screen.getByLabelText('Add to Cares about');
  fireEvent.change(add, { target: { value: text } });
  fireEvent.keyDown(add, { key: 'Enter' });
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

  it('moves on from a list row on Enter and does not save', async () => {
    const fetchMock = stubFetch((method, path) =>
      method === 'POST' && path.endsWith('/avatars') ? json(SAVED, 201) : undefined,
    );
    renderAt('/avatars/new');
    fillRequired('Skeptical CFO');
    addCaresAbout('Payback period');

    pressEnter(screen.getByLabelText('Cares about 1'));
    expect(screen.getByLabelText('Cares about 2')).toHaveFocus();
    pressEnter(screen.getByLabelText('Cares about 2'));
    expect(screen.getByLabelText('Add to Cares about')).toHaveFocus();
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('keeps a list message when its row loses focus without a fix', async () => {
    stubFetch(() => undefined);
    renderAt('/avatars/new');
    fillRequired('Skeptical CFO');
    const row = screen.getByLabelText('Cares about 1');
    fireEvent.change(row, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByText('Enter something here.')).closest('li')).toContainElement(row);

    fireEvent.blur(row);
    await settle();

    expect(screen.getByText('Enter something here.').closest('li')).toContainElement(row);
    expect(row).toBeInvalid();
  });

  it('checks a list row when it loses focus', async () => {
    stubFetch(() => undefined);
    renderAt('/avatars/new');
    fillRequired('Skeptical CFO');
    const row = screen.getByLabelText('Cares about 1');
    fireEvent.change(row, { target: { value: ' ' } });
    fireEvent.blur(row);

    expect((await screen.findByText('Enter something here.')).closest('li')).toContainElement(row);
  });

  it('shows the message for a whole list together with a repeated row', async () => {
    const topics = Array.from({ length: 10 }, (_, index) => `Topic ${index + 1}`);
    const crowded = { ...SAVED, ignores: [...topics, 'Topic 1'] };
    const fetchMock = stubFetch((method, path) =>
      method === 'GET' && path.endsWith(`/avatars/${SAVED.id}`) ? json(crowded) : undefined,
    );
    renderAt(`/avatars/${SAVED.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    const repeated = await screen.findByText('Already in this list.');
    expect(repeated.closest('li')).toContainElement(screen.getByLabelText('Ignores 11'));
    expect(screen.getByText('Use at most 10.')).toHaveAttribute('id', 'ignores-error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('takes the message away with the row it was about', async () => {
    const fetchMock = stubFetch(() => undefined);
    renderAt('/avatars/new');
    fillRequired('Skeptical CFO');
    fireEvent.change(screen.getByLabelText('Cares about 1'), { target: { value: '' } });
    addCaresAbout('Cash runway');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const message = await screen.findByText('Enter something here.');
    expect(message.closest('li')).toContainElement(screen.getByLabelText('Cares about 1'));

    fireEvent.click(screen.getByRole('button', { name: 'Remove Cares about 1' }));
    await settle();

    const row = screen.getByLabelText('Cares about 1');
    expect(row).toHaveValue('Cash runway');
    expect(row).not.toBeInvalid();
    expect(screen.queryByText('Enter something here.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cares about 2')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('takes a message from the service away with the row it was about', async () => {
    stubFetch((method, path) =>
      method === 'POST' && path.endsWith('/avatars')
        ? problem(400, {
            detail: 'The avatar is not valid.',
            errors: [{ field: '/caresAbout/0', message: 'This one is not allowed.' }],
          })
        : undefined,
    );
    renderAt('/avatars/new');
    fillRequired('Skeptical CFO');
    addCaresAbout('Cash runway');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const message = await screen.findByText('This one is not allowed.');
    expect(message.closest('li')).toContainElement(screen.getByLabelText('Cares about 1'));

    fireEvent.click(screen.getByRole('button', { name: 'Remove Cares about 1' }));
    await settle();

    expect(screen.getByLabelText('Cares about 1')).toHaveValue('Cash runway');
    expect(screen.queryByText('This one is not allowed.')).not.toBeInTheDocument();
  });

  it('opens the delete question with the keyboard on Cancel', async () => {
    stubFetch((method, path) => (method === 'GET' && path.endsWith(`/avatars/${SAVED.id}`) ? json(SAVED) : undefined));
    renderAt(`/avatars/${SAVED.id}`);
    const open = await screen.findByRole('button', { name: 'Delete' });
    const dialog = document.querySelector('dialog');
    if (!dialog) throw new Error('The delete question is not on the page.');
    // jsdom has no showModal.
    dialog.showModal = () => dialog.setAttribute('open', '');
    open.focus();
    fireEvent.click(open);

    expect(screen.getByRole('dialog', { name: 'Delete Skeptical CFO?' })).toBe(dialog);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });
});
