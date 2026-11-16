import { describe, expect, it } from "vitest";

import { historyForAnswer, historyForClassifier, SessionStore, type Turn } from "../src/conversation.js";

function turn(n: number, overrides: Partial<Turn> = {}): Turn {
  return { question: `Question ${n}`, answer: `Answer ${n}`, avatarId: "a-1", avatarName: "Skeptical CFO", ...overrides };
}

const session = (id: string) => ({ id, createdAt: "2026-11-16T10:00:00.000Z" });

describe("SessionStore", () => {
  it("keeps the turns of each session apart, in order", () => {
    const store = new SessionStore();
    store.create(session("one"));
    store.create(session("two"));
    store.addTurn("one", turn(1));
    store.addTurn("one", turn(2));
    expect(store.turns("one").map((t) => t.question)).toEqual(["Question 1", "Question 2"]);
    expect(store.turns("two")).toEqual([]);
    expect(store.has("three")).toBe(false);
    expect(store.turns("three")).toEqual([]);
    store.addTurn("three", turn(1));
    expect(store.has("three")).toBe(false);
  });

  it("keeps only the latest thirty turns of a session", () => {
    const store = new SessionStore();
    store.create(session("one"));
    for (let n = 1; n <= 35; n += 1) store.addTurn("one", turn(n));
    const kept = store.turns("one");
    expect(kept).toHaveLength(30);
    expect(kept[0]?.question).toBe("Question 6");
    expect(kept.at(-1)?.question).toBe("Question 35");
  });

  it("drops the session unused for longest when it is full", () => {
    const store = new SessionStore(2);
    store.create(session("one"));
    store.create(session("two"));
    // Reading "one" makes "two" the one unused for longest.
    store.turns("one");
    store.create(session("three"));
    expect(store.has("one")).toBe(true);
    expect(store.has("two")).toBe(false);
    expect(store.has("three")).toBe(true);
  });
});

describe("historyForAnswer", () => {
  it("turns each exchange into a user message and an assistant message, oldest first", () => {
    expect(historyForAnswer([turn(1), turn(2)])).toEqual([
      { role: "user", content: "Question 1" },
      { role: "assistant", content: "Answer 1" },
      { role: "user", content: "Question 2" },
      { role: "assistant", content: "Answer 2" },
    ]);
    expect(historyForAnswer([])).toEqual([]);
  });

  it("shows the newest twelve turns at most", () => {
    const turns = Array.from({ length: 20 }, (_, index) => turn(index + 1));
    const messages = historyForAnswer(turns);
    expect(messages).toHaveLength(24);
    expect(messages[0]?.content).toBe("Question 9");
    expect(messages.at(-1)?.content).toBe("Answer 20");
  });

  it("drops the oldest turns of a long chat to stay within the size budget, never part of a turn", () => {
    const long = "x".repeat(10_000);
    const turns = [turn(1, { answer: long }), turn(2, { answer: long }), turn(3, { answer: long })];
    const messages = historyForAnswer(turns);
    expect(messages.map((message) => message.content.slice(0, 10))).toEqual(["Question 2", "xxxxxxxxxx", "Question 3", "xxxxxxxxxx"]);
    // One turn larger than the whole budget is left out rather than cut.
    expect(historyForAnswer([turn(1, { answer: "y".repeat(30_000) })])).toEqual([]);
  });
});

describe("historyForClassifier", () => {
  it("gives the last three turns, shortened, with who answered", () => {
    const turns = [turn(1), turn(2), turn(3), turn(4, { answer: `  Many\n\nwords ${"z".repeat(400)}`, avatarId: "a-2", avatarName: "QA Tester" })];
    const recent = historyForClassifier(turns);
    expect(recent.map((t) => t.question)).toEqual(["Question 2", "Question 3", "Question 4"]);
    expect(recent[2]?.answeredBy).toEqual({ id: "a-2", name: "QA Tester" });
    expect(recent[2]?.answer.startsWith("Many words zzz")).toBe(true);
    expect(recent[2]?.answer.length).toBe(301);
    expect(recent[2]?.answer.endsWith("…")).toBe(true);
  });
});
