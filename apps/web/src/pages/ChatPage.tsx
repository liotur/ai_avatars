import { createSession, type AvatarEvent, type MessageRequest, type Session } from '@avatars/contracts/assistant';
import { zMessageRequest } from '@avatars/contracts/assistant/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { fetchAvatars } from '../api/avatars';
import { assistantApiUrl } from '../api/config';
import { ProblemError, toProblemError } from '../api/problem';
import { AvatarNotFoundError, SessionNotFoundError, streamMessage, type ChatStreamEvent } from '../api/stream';
import { readableValidationMessage } from '../form/schema';
import { useDocumentTitle } from '../useDocumentTitle';

type Turn = {
  id: string;
  content: string;
  pending: boolean;
  answer: string;
  error?: string;
  avatar?: {
    id: string;
    name: string;
    mode: AvatarEvent['selection']['mode'];
    reason?: string;
  };
};

/** How close to the bottom, in pixels, still counts as following the answer. */
const STICK_DISTANCE = 96;

async function openSession(): Promise<Session> {
  const result = await createSession({ baseUrl: assistantApiUrl });
  if (result.error) throw toProblemError(result.error, result.response);
  if (!result.data) throw new ProblemError(undefined, 'The chat session could not be opened.');
  return result.data;
}

export function ChatPage() {
  useDocumentTitle('Chat');
  const queryClient = useQueryClient();
  const [chatKey] = useState(() => crypto.randomUUID());
  const [avatarId, setAvatarId] = useState('');
  const [content, setContent] = useState('');
  const [contentError, setContentError] = useState<string>();
  const [composerError, setComposerError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [sending, setSending] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const page = document.scrollingElement;
      if (!page) return;
      stickToBottom.current = page.scrollHeight - page.scrollTop - page.clientHeight < STICK_DISTANCE;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const page = document.scrollingElement;
    if (page && stickToBottom.current) page.scrollTop = page.scrollHeight;
  }, [turns]);

  const sessionKey = ['chat-session', chatKey];
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: openSession,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const avatars = useQuery({
    queryKey: ['avatars'],
    queryFn: fetchAvatars,
  });

  const avatarOptions = avatars.data ?? [];
  const selectedId =
    !avatars.isSuccess || avatarOptions.some((avatar) => avatar.id === avatarId) ? avatarId : '';
  const sessionError = session.error instanceof ProblemError ? session.error.detail : session.isError ? 'The chat could not be opened.' : undefined;
  const canSend = Boolean(session.data) && !sending && content.trim().length > 0;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session.data || sending) return;
    const body: MessageRequest = selectedId ? { content: content.trim(), avatarId: selectedId } : { content: content.trim() };
    const parsed = zMessageRequest.safeParse(body);
    if (!parsed.success) {
      setContentError(readableValidationMessage(parsed.error.issues[0]?.message ?? 'Enter a message.'));
      return;
    }
    setContentError(undefined);
    setComposerError(undefined);
    setNotice(undefined);
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let started = false;
    let settled = false;
    const turnId = crypto.randomUUID();
    const asked = parsed.data.content;
    const update = (change: (turn: Turn) => Turn) =>
      setTurns((current) => current.map((turn) => (turn.id === turnId ? change(turn) : turn)));

    stickToBottom.current = true;
    setTurns((current) => [...current, { id: turnId, content: asked, pending: true, answer: '' }]);
    setContent('');
    messageRef.current?.focus();

    const onEvent = (streamEvent: ChatStreamEvent) => {
      if (settled && streamEvent.event === 'delta') return;
      if (streamEvent.event === 'avatar') {
        const { avatar, selection } = streamEvent.data;
        if (selection.mode === 'created') {
          void queryClient.invalidateQueries({ queryKey: ['avatars'] });
        }
        update((turn) => ({
          ...turn,
          avatar: {
            id: avatar.id,
            name: avatar.name,
            mode: selection.mode,
            ...(selection.reason ? { reason: selection.reason } : {}),
          },
        }));
        return;
      }
      if (streamEvent.event === 'delta') {
        update((turn) => ({ ...turn, answer: turn.answer + streamEvent.data.text }));
        return;
      }
      if (streamEvent.event === 'error') {
        settled = true;
        const detail = streamEvent.data.detail || streamEvent.data.title;
        update((turn) => ({ ...turn, pending: false, error: detail }));
        return;
      }
      if (streamEvent.event === 'done') {
        settled = true;
        update((turn) => ({ ...turn, pending: false }));
      }
    };

    const send = (sessionId: string) =>
      streamMessage(sessionId, parsed.data, onEvent, {
        signal: controller.signal,
        onOpen: () => {
          started = true;
        },
      });

    try {
      let status: Awaited<ReturnType<typeof streamMessage>>;
      try {
        status = await send(session.data.id);
      } catch (error) {
        if (!(error instanceof SessionNotFoundError) || started) throw error;
        const fresh = await openSession();
        queryClient.setQueryData(sessionKey, fresh);
        setNotice('The assistant restarted, so a new chat was opened.');
        status = await send(fresh.id);
      }
      if (status === 'aborted') return;
      if (started && !settled) {
        update((turn) => ({ ...turn, pending: false, error: turn.error ?? 'The answer stopped before it finished.' }));
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const detail = error instanceof ProblemError ? error.detail : 'The message could not be sent.';
      if (error instanceof AvatarNotFoundError) {
        void queryClient.invalidateQueries({ queryKey: ['avatars'] });
      }
      if (started) {
        update((turn) => ({ ...turn, pending: false, error: detail }));
      } else {
        setTurns((current) => current.filter((turn) => turn.id !== turnId));
        setContent((current) => (current.trim() ? current : asked));
        setComposerError(detail);
      }
    } finally {
      if (!controller.signal.aborted) setSending(false);
    }
  }

  function onMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) event.currentTarget.form?.requestSubmit();
  }

  return (
    <div className="chat">
      <h1 className="visually-hidden">Chat</h1>
      <ol className="thread">
        {turns.map((turn) => (
          <li key={turn.id}>
            <p className="user-message">{turn.content}</p>
            {!turn.avatar && turn.pending ? (
              <p className="status" role="status">
                Waiting for an answer.
              </p>
            ) : null}
            {turn.avatar ? (
              <div className="answer">
                <p className="answer-meta">
                  <Link to={`/avatars/${turn.avatar.id}`}>{turn.avatar.name}</Link>
                  {' · '}
                  <span>{turn.avatar.mode}</span>
                </p>
                {turn.avatar.reason ? <p className="answer-reason">{turn.avatar.reason}</p> : null}
                <div className="answer-body">
                  {turn.answer ? <p className="answer-text">{turn.answer}</p> : null}
                  {!turn.answer && !turn.error && turn.pending ? <p className="status">Writing.</p> : null}
                  {turn.error ? (
                    <p className="field-error" role="alert">
                      {turn.error}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
            {!turn.avatar && turn.error ? (
              <p className="field-error" role="alert">
                {turn.error}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <form className="composer" onSubmit={(event) => void onSubmit(event)}>
        {session.isPending ? <p role="status">Opening a chat.</p> : null}
        {sessionError ? (
          <div className="notice" role="alert">
            <p className="field-error">{sessionError}</p>
            <button type="button" className="button button-quiet" onClick={() => void session.refetch()}>
              Try again
            </button>
          </div>
        ) : null}
        {notice ? (
          <p className="hint" role="status">
            {notice}
          </p>
        ) : null}
        {composerError ? (
          <p className="field-error" role="alert">
            {composerError}
          </p>
        ) : null}
        {avatars.isError ? (
          <div className="notice">
            <p className="hint">Avatars could not be loaded. You can still let the assistant choose.</p>
            <button type="button" className="button button-quiet" onClick={() => void avatars.refetch()}>
              Try again
            </button>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="answer-as">Answer as</label>
          <select
            id="answer-as"
            value={selectedId}
            disabled={!session.data}
            onChange={(event) => setAvatarId(event.target.value)}
          >
            <option value="">Let the assistant choose</option>
            {avatarOptions.map((avatar) => (
              <option key={avatar.id} value={avatar.id}>
                {avatar.name}
              </option>
            ))}
          </select>
        </div>
        <div className="send-row">
          <div className="field">
            <label htmlFor="message">Ask something</label>
            <textarea
              id="message"
              ref={messageRef}
              rows={2}
              value={content}
              disabled={!session.data}
              aria-invalid={contentError ? true : undefined}
              aria-describedby={contentError ? 'message-error' : undefined}
              onKeyDown={onMessageKeyDown}
              onChange={(event) => {
                setContent(event.target.value);
                setContentError(undefined);
              }}
            />
            {contentError ? (
              <p id="message-error" className="field-error" role="alert">
                {contentError}
              </p>
            ) : null}
          </div>
          <button type="submit" className="button button-primary" disabled={!canSend}>
            Send
          </button>
        </div>
        {sending ? (
          <p className="visually-hidden" role="status">
            Sending.
          </p>
        ) : null}
      </form>
    </div>
  );
}
