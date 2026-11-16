import type { Session } from "@avatars/contracts/assistant";

/** One exchange in a chat: what was asked, who answered, and what they said. */
export type Turn = {
  question: string;
  answer: string;
  avatarId: string;
  avatarName: string;
};

/** One message of the conversation, as a model is shown it. */
export type ChatMessage = { role: "user" | "assistant"; content: string };

/** What the classifier is shown of an earlier turn: enough to recognise a follow-up. */
export type ClassifierTurn = {
  question: string;
  answeredBy: { id: string; name: string };
  answer: string;
};

type StoredSession = Session & { turns: Turn[] };

/** Turns kept per session. Older ones are dropped. */
const TURNS_KEPT = 30;
/** Sessions kept. The one unused for longest is dropped first; its chat then opens a new session. */
const SESSIONS_KEPT = 200;

/** What the answer call is shown: the newest turns that fit, so a long chat cannot outgrow the model. */
const ANSWER_TURNS = 12;
const ANSWER_CHARACTERS = 24_000;

/** What the classifier is shown: the last few turns, shortened. */
const CLASSIFIER_TURNS = 3;
const CLASSIFIER_EXCERPT = 300;

/**
 * Chats and their turns, in memory. A restart forgets them, and the UI then
 * opens a new session.
 */
export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  constructor(private readonly limit = SESSIONS_KEPT) {}

  create(session: Session): void {
    this.sessions.set(session.id, { ...session, turns: [] });
    // A Map keeps insertion order, so its first key is the session unused for longest.
    while (this.sessions.size > this.limit) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /** The turns so far, oldest first. Reading a session marks it as recently used. */
  turns(id: string): readonly Turn[] {
    const session = this.sessions.get(id);
    if (!session) return [];
    this.sessions.delete(id);
    this.sessions.set(id, session);
    return session.turns;
  }

  /** Records an exchange. Does nothing when the session is gone. */
  addTurn(id: string, turn: Turn): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.turns.push(turn);
    if (session.turns.length > TURNS_KEPT) session.turns.splice(0, session.turns.length - TURNS_KEPT);
  }
}

/** The earlier turns as messages for the answer call, oldest first, within the size budget. */
export function historyForAnswer(turns: readonly Turn[]): ChatMessage[] {
  const recent = turns.slice(-ANSWER_TURNS);
  let size = 0;
  let start = recent.length;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const turn = recent[index];
    if (!turn) continue;
    size += turn.question.length + turn.answer.length;
    if (size > ANSWER_CHARACTERS) break;
    start = index;
  }
  return recent.slice(start).flatMap((turn): ChatMessage[] => [
    { role: "user", content: turn.question },
    { role: "assistant", content: turn.answer },
  ]);
}

/** The last few turns, shortened, for deciding whether a message continues the conversation. */
export function historyForClassifier(turns: readonly Turn[]): ClassifierTurn[] {
  return turns.slice(-CLASSIFIER_TURNS).map((turn) => ({
    question: excerpt(turn.question),
    answeredBy: { id: turn.avatarId, name: turn.avatarName },
    answer: excerpt(turn.answer),
  }));
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > CLASSIFIER_EXCERPT ? `${flat.slice(0, CLASSIFIER_EXCERPT)}…` : flat;
}
