import {
  createSession,
  type AvatarEvent,
  type EvaluationEvent,
  type MessageRequest,
  type Session,
  type StageEvent,
} from '@avatars/contracts/assistant';
import { zMessageRequest } from '@avatars/contracts/assistant/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ASSISTANT_STATUS_KEY, fetchAssistantStatus } from '../api/assistant';
import { fetchAvatars } from '../api/avatars';
import { assistantApiUrl } from '../api/config';
import { ProblemError, toProblemError } from '../api/problem';
import { AvatarNotFoundError, SessionNotFoundError, streamMessage, type ChatStreamEvent } from '../api/stream';
import { AvatarOrb } from '../components/AvatarOrb';
import { Icon, type IconName } from '../components/Icon';
import { Markdown } from '../components/Markdown';
import { readableValidationMessage } from '../form/schema';
import { newId } from '../id';
import { useDocumentTitle } from '../useDocumentTitle';

type Mode = AvatarEvent['selection']['mode'];

type Turn = {
  id: string;
  content: string;
  pending: boolean;
  answer: string;
  /** The avatar the person asked for, shown while waiting. */
  requested?: string;
  /** The person stopped the answer. */
  stopped?: boolean;
  /** What the assistant is doing before the answer is confirmed. */
  stage?: StageEvent['stage'];
  /** The draft as it is written: work in progress, shown as thinking. Not the answer. */
  draft?: string;
  /** How the check of the draft went. Absent when answers are not checked. */
  evaluation?: EvaluationEvent;
  error?: string;
  avatar?: {
    id: string;
    name: string;
    mode: Mode;
    reason?: string;
  };
};

/** How close to the bottom, in pixels, still counts as following the answer. */
const STICK_DISTANCE = 96;

const STAGE_TEXT: Record<StageEvent['stage'], string> = {
  drafting: 'Thinking.',
  checking: 'Validating the answer.',
  revising: 'Rewriting after validation.',
};

const VERDICT: Record<EvaluationEvent['verdict'], { label: string; icon: IconName; className: string }> = {
  passed: { label: 'validated', icon: 'check', className: 'badge badge-ok' },
  revised: { label: 'rewritten after validation', icon: 'refresh', className: 'badge badge-warn' },
  skipped: { label: 'not validated', icon: 'alert', className: 'badge' },
};

const CHECK_NAMES: Record<EvaluationEvent['failed'][number], string> = {
  answers: 'did not answer the question',
  sound: 'was not sound',
  stance: "did not follow the avatar's stance",
  voice: "did not fit the avatar's voice",
};

/** One line on why the first draft did not become the answer, or why the answer is not validated. */
function evaluationNote(evaluation: EvaluationEvent): string | undefined {
  if (evaluation.verdict === 'passed') return undefined;
  if (evaluation.verdict === 'skipped') return evaluation.note;
  const reasons = evaluation.failed.map((name) => CHECK_NAMES[name]);
  const why = reasons.length > 0 ? `The first draft ${reasons.join(' and ')}.` : 'The first draft did not pass validation.';
  return evaluation.note ? `${why} ${evaluation.note}` : why;
}

const MODE_ICON: Record<Mode, IconName> = {
  chosen: 'target',
  created: 'sparkles',
  requested: 'user',
};

const SUGGESTIONS = [
  'Should I ask for budget to hire two more engineers?',
  'I might move abroad for a job. What should I weigh?',
  'Explain how vaccines work to a curious ten-year-old.',
];

/** Shown in the opening picture until the library has avatars of its own. */
const SAMPLE_NAMES = ['Skeptic', 'Mentor', 'Future me'];

async function openSession(): Promise<Session> {
  const result = await createSession({ baseUrl: assistantApiUrl });
  if (result.error) throw toProblemError(result.error, result.response);
  if (!result.data) throw new ProblemError(undefined, 'The chat session could not be opened.');
  return result.data;
}

export function ChatPage() {
  useDocumentTitle('Chat');
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [chatKey, setChatKey] = useState(newId);
  const [avatarId, setAvatarId] = useState(() => searchParams.get('avatar') ?? '');
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

  // The message box grows with its text, up to the height set in the stylesheet.
  useEffect(() => {
    const box = messageRef.current;
    if (!box) return;
    box.style.height = 'auto';
    if (box.scrollHeight > 0) box.style.height = `${box.scrollHeight}px`;
  }, [content]);

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

  const status = useQuery({
    queryKey: ASSISTANT_STATUS_KEY,
    queryFn: fetchAssistantStatus,
    staleTime: 30_000,
  });

  const avatarOptions = avatars.data ?? [];
  const selected = avatarOptions.find((avatar) => avatar.id === avatarId);
  const selectedId = !avatars.isSuccess || selected ? avatarId : '';
  const sessionError =
    session.error instanceof ProblemError
      ? session.error.detail
      : session.isError
        ? 'The chat could not be opened.'
        : undefined;
  // Only a clear "not ready" blocks the composer. An unknown state does not.
  const notReady = status.data?.ready === false;
  const usable = Boolean(session.data) && !notReady;
  const canSend = usable && !sending && content.trim().length > 0;
  const introNames = avatarOptions.length >= 3 ? avatarOptions.slice(0, 3).map((avatar) => avatar.name) : SAMPLE_NAMES;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session.data || sending || notReady) return;
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
    const turnId = newId();
    const asked = parsed.data.content;
    const update = (change: (turn: Turn) => Turn) =>
      setTurns((current) => current.map((turn) => (turn.id === turnId ? change(turn) : turn)));

    stickToBottom.current = true;
    setTurns((current) => [
      ...current,
      { id: turnId, content: asked, pending: true, answer: '', ...(selected ? { requested: selected.name } : {}) },
    ]);
    setContent('');
    messageRef.current?.focus();

    const onEvent = (streamEvent: ChatStreamEvent) => {
      if (controller.signal.aborted) return;
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
      if (streamEvent.event === 'stage') {
        update((turn) => ({ ...turn, stage: streamEvent.data.stage }));
        return;
      }
      if (streamEvent.event === 'draft') {
        update((turn) => ({ ...turn, draft: (turn.draft ?? '') + streamEvent.data.text }));
        return;
      }
      if (streamEvent.event === 'evaluation') {
        update((turn) => ({ ...turn, evaluation: streamEvent.data }));
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
      let result: Awaited<ReturnType<typeof streamMessage>>;
      try {
        result = await send(session.data.id);
      } catch (error) {
        if (!(error instanceof SessionNotFoundError) || started) throw error;
        const fresh = await openSession();
        queryClient.setQueryData(sessionKey, fresh);
        setNotice('The assistant restarted, so it no longer remembers the earlier messages.');
        result = await send(fresh.id);
      }
      if (result === 'aborted') return;
      if (started && !settled) {
        update((turn) => ({ ...turn, pending: false, error: turn.error ?? 'The answer stopped before it finished.' }));
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const detail = error instanceof ProblemError ? error.detail : 'The message could not be sent.';
      if (error instanceof AvatarNotFoundError) {
        void queryClient.invalidateQueries({ queryKey: ['avatars'] });
      }
      if (error instanceof ProblemError && error.status === 503) {
        void queryClient.invalidateQueries({ queryKey: ASSISTANT_STATUS_KEY });
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

  /** Ends the answer in progress. What has arrived so far stays. */
  function stop() {
    const controller = abortRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
    setTurns((current) => current.map((turn) => (turn.pending ? { ...turn, pending: false, stopped: true } : turn)));
    setSending(false);
    messageRef.current?.focus();
  }

  /**
   * Starts over: an empty thread and a new session, so the assistant no longer
   * has the earlier messages in view.
   */
  function newChat() {
    abortRef.current?.abort();
    setTurns([]);
    setSending(false);
    setComposerError(undefined);
    setContentError(undefined);
    setNotice(undefined);
    setChatKey(newId());
    messageRef.current?.focus();
  }

  function onMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) event.currentTarget.form?.requestSubmit();
  }

  function fillSuggestion(text: string) {
    setContent(text);
    setContentError(undefined);
    messageRef.current?.focus();
  }

  return (
    <div className="chat">
      <h1 className="visually-hidden">Chat</h1>
      {turns.length === 0 ? (
        <div className="chat-intro">
          <div className="orb-cluster">
            {introNames.map((name) => (
              <AvatarOrb key={name} name={name} size="lg" />
            ))}
          </div>
          <h2>
            Ask anything. <span className="gradient-text">The right avatar answers.</span>
          </h2>
          <p className="lede">
            The assistant picks the avatar that fits your question, drafts a new one when none does, and remembers the
            conversation for follow-ups.
          </p>
          <ul className="suggestions" aria-label="Example questions">
            {SUGGESTIONS.map((text) => (
              <li key={text}>
                <button type="button" className="suggestion" disabled={!usable} onClick={() => fillSuggestion(text)}>
                  {text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ol className="thread">
        {turns.map((turn) => (
          <li key={turn.id}>
            <p className="user-message">{turn.content}</p>
            {!turn.avatar && turn.pending ? (
              <p className="status" role="status">
                <span className="dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {turn.requested ? `Asking ${turn.requested}.` : 'Choosing an avatar.'}
              </p>
            ) : null}
            {turn.avatar ? (
              <div className="answer">
                <AvatarOrb name={turn.avatar.name} />
                <div className="answer-main">
                  <p className="answer-meta">
                    {/* A new tab, so following the link does not throw the conversation away. */}
                    <Link to={`/avatars/${turn.avatar.id}`} target="_blank" rel="noopener noreferrer">
                      {turn.avatar.name}
                      <span className="visually-hidden"> (opens in a new tab)</span>
                    </Link>
                    <span className={turn.avatar.mode === 'created' ? 'badge badge-accent' : 'badge'}>
                      <Icon name={MODE_ICON[turn.avatar.mode]} />
                      {turn.avatar.mode}
                    </span>
                    {turn.evaluation ? (
                      <span className={VERDICT[turn.evaluation.verdict].className}>
                        <Icon name={VERDICT[turn.evaluation.verdict].icon} />
                        {VERDICT[turn.evaluation.verdict].label}
                      </span>
                    ) : null}
                  </p>
                  {turn.avatar.reason ? <p className="answer-reason">{turn.avatar.reason}</p> : null}
                  {turn.evaluation && evaluationNote(turn.evaluation) ? (
                    <p className="answer-reason">{evaluationNote(turn.evaluation)}</p>
                  ) : null}
                  <div
                    className={
                      turn.pending && (turn.answer || (turn.draft && turn.stage === 'drafting'))
                        ? 'answer-body streaming'
                        : 'answer-body'
                    }
                  >
                    {!turn.answer && !turn.error && turn.pending ? (
                      <p className="status" role="status">
                        <span className="dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                        {turn.stage ? STAGE_TEXT[turn.stage] : 'Writing.'}
                      </p>
                    ) : null}
                    {/* The draft is shown as thinking until an answer takes its place. */}
                    {!turn.answer && turn.draft ? (
                      <div className="thinking">
                        <Markdown text={turn.draft} />
                      </div>
                    ) : null}
                    {turn.answer ? <Markdown text={turn.answer} /> : null}
                    {turn.answer && turn.draft && turn.evaluation?.verdict === 'revised' ? (
                      <details className="first-draft">
                        <summary>First draft, before validation</summary>
                        <Markdown text={turn.draft} />
                      </details>
                    ) : null}
                    {turn.stopped ? <p className="answer-stopped">You stopped this answer.</p> : null}
                    {turn.error ? (
                      <p className="field-error" role="alert">
                        {turn.error}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {!turn.avatar && turn.stopped ? <p className="answer-stopped">You stopped this before an answer.</p> : null}
            {!turn.avatar && turn.error ? (
              <p className="field-error" role="alert">
                {turn.error}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <form className="composer" onSubmit={(event) => void onSubmit(event)}>
        {session.isPending ? (
          <p className="status" role="status">
            Opening a chat.
          </p>
        ) : null}
        {sessionError ? (
          <div className="notice notice-error" role="alert">
            <p>{sessionError}</p>
            <button type="button" className="button button-quiet" onClick={() => void session.refetch()}>
              Try again
            </button>
          </div>
        ) : null}
        {notReady ? (
          <div className="notice notice-warn" role="status">
            <div className="notice-body">
              <p className="notice-title">
                <Icon name="alert" />
                The assistant has no language model yet
              </p>
              <p>{status.data?.detail ?? 'Set a model key, then restart the assistant.'}</p>
            </div>
            <button type="button" className="button button-quiet" onClick={() => void status.refetch()}>
              Check again
            </button>
          </div>
        ) : null}
        {notice ? (
          <p className="hint" role="status">
            {notice}
          </p>
        ) : null}
        {composerError ? (
          <div className="notice notice-error">
            <p role="alert">{composerError}</p>
          </div>
        ) : null}
        {avatars.isError ? (
          <div className="notice">
            <p className="hint">Avatars could not be loaded. You can still let the assistant choose.</p>
            <button type="button" className="button button-quiet" onClick={() => void avatars.refetch()}>
              Try again
            </button>
          </div>
        ) : null}
        <div className="composer-box">
          <div className="composer-row">
            <div className="field">
              <label htmlFor="message" className="visually-hidden">
                Ask something
              </label>
              <textarea
                id="message"
                ref={messageRef}
                rows={1}
                placeholder="Ask something"
                value={content}
                disabled={!usable}
                aria-invalid={contentError ? true : undefined}
                aria-describedby={contentError ? 'message-error' : undefined}
                onKeyDown={onMessageKeyDown}
                onChange={(event) => {
                  setContent(event.target.value);
                  setContentError(undefined);
                }}
              />
            </div>
          </div>
          {contentError ? (
            <p id="message-error" className="field-error" role="alert">
              {contentError}
            </p>
          ) : null}
          <div className="composer-tools">
            <div className="answer-as">
              {selected ? <AvatarOrb name={selected.name} size="sm" /> : <Icon name="sparkles" />}
              <label htmlFor="answer-as">Answer as</label>
              <select
                id="answer-as"
                value={selectedId}
                disabled={!usable}
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
            {turns.length > 0 ? (
              <button type="button" className="button button-quiet new-chat" onClick={newChat}>
                <Icon name="plus" />
                New chat
              </button>
            ) : null}
            {sending ? (
              <button type="button" className="send send-stop" onClick={stop}>
                <Icon name="stop" />
                <span className="visually-hidden">Stop</span>
              </button>
            ) : (
              <button type="submit" className="send" disabled={!canSend}>
                <Icon name="arrow-up" />
                <span className="visually-hidden">Send</span>
              </button>
            )}
          </div>
        </div>
        <p className="composer-hint">Enter sends. Shift and Enter starts a new line.</p>
        {sending ? (
          <p className="visually-hidden" role="status">
            Sending.
          </p>
        ) : null}
      </form>
    </div>
  );
}
