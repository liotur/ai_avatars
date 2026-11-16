import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Avatar, Problem } from "../src/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { STARTER_AVATARS } from "../src/starters.js";
import { zAvatarCreateRequest } from "../src/validation.js";

const starterNames = STARTER_AVATARS.map((avatar) => avatar.name);

/** The starters plus the given names, in the order the service lists them. */
function withStarters(...names: string[]): string[] {
  return [...starterNames, ...names].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
}

const requiredFields = {
  description: "A practical guide for concrete decisions.",
  perspective: "Looks for the next useful step.",
  voice: "Plain and specific.",
  caresAbout: ["What to do next"],
};

describe("configuration", () => {
  it("defaults port, cors origin, and a database path inside the app", () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.corsOrigin).toBe("http://localhost:5173");
    expect(config.databasePath).toBe(
      path.resolve(fileURLToPath(new URL("..", import.meta.url)), "data/avatars.db"),
    );
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ PORT: "nope" })).toThrow(/Invalid environment/);
  });
});

describe("avatar manager", () => {
  let directory: string;
  let close: () => void;
  let request: (input: string, init?: RequestInit) => Promise<Response>;
  let now: Date;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "avatar-manager-"));
    now = new Date("2026-11-16T10:30:00.000Z");
    const created = createApp({
      databasePath: path.join(directory, "avatars.db"),
      corsOrigin: "http://localhost:5173",
      now: () => {
        const current = now;
        now = new Date(now.getTime() + 1000);
        return current;
      },
    });
    close = created.close;
    request = (input, init) => Promise.resolve(created.app.request(input, init));
  });

  afterEach(() => {
    close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("creates, lists, patches, rejects a duplicate name, and deletes", async () => {
    const created = await request("/v1/avatars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Field Guide", ...requiredFields }),
    });
    expect(created.status).toBe(201);
    const avatar = (await created.json()) as Avatar;
    expect(created.headers.get("location")).toBe(`/v1/avatars/${avatar.id}`);
    expect(avatar).toMatchObject({
      name: "Field Guide",
      ...requiredFields,
      ignores: [],
      useWhen: [],
      intensity: "balanced",
      createdBy: "user",
    });
    expect(avatar.createdAt).toBe(avatar.updatedAt);
    expect(avatar.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const listed = await request("/v1/avatars");
    expect(listed.status).toBe(200);
    const list = (await listed.json()) as { items: Avatar[] };
    expect(list.items.map((item) => item.name)).toEqual(withStarters("Field Guide"));

    const patched = await request(`/v1/avatars/${avatar.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        voice: "Blunt. One sentence per point.",
        ignores: ["Status", "Small talk"],
      }),
    });
    expect(patched.status).toBe(200);
    const edited = (await patched.json()) as Avatar;
    expect(edited).toMatchObject({
      id: avatar.id,
      name: "Field Guide",
      caresAbout: ["What to do next"],
      voice: "Blunt. One sentence per point.",
      ignores: ["Status", "Small talk"],
      createdBy: "user",
      createdAt: avatar.createdAt,
    });
    expect(edited.updatedAt).not.toBe(avatar.createdAt);

    const fetched = await request(`/v1/avatars/${avatar.id}`);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toEqual(edited);

    const recased = await request(`/v1/avatars/${avatar.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "field guide" }),
    });
    expect(recased.status).toBe(200);
    expect(((await recased.json()) as Avatar).name).toBe("field guide");

    const duplicate = await request("/v1/avatars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "field guide", ...requiredFields }),
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.headers.get("content-type")).toContain("application/problem+json");
    expect(await duplicate.json()).toEqual({
      type: "https://avatar.local/problems/name-taken",
      title: "Avatar name already in use",
      status: 409,
      detail: 'An avatar named "field guide" already exists.',
    });

    const renamed = await request(`/v1/avatars/${avatar.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "GENERALIST" }),
    });
    expect(renamed.status).toBe(409);
    expect(await renamed.json()).toEqual({
      type: "https://avatar.local/problems/name-taken",
      title: "Avatar name already in use",
      status: 409,
      detail: 'An avatar named "GENERALIST" already exists.',
    });

    const deleted = await request(`/v1/avatars/${avatar.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");

    const missing = await request(`/v1/avatars/${avatar.id}`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/problem+json");
    expect(await missing.json()).toEqual({
      type: "https://avatar.local/problems/avatar-not-found",
      title: "Avatar not found",
      status: 404,
      detail: `No avatar with id ${avatar.id}.`,
    });
  });

  it("lists avatars in case-insensitive name order and seeds the starters once", async () => {
    await postAvatar({ name: "Zebra", intensity: "immersive", createdBy: "assistant" });
    await postAvatar({ name: "mango" });

    const listed = await request("/v1/avatars");
    const body = (await listed.json()) as { items: Avatar[] };
    expect(body.items.map((item) => item.name)).toEqual(withStarters("mango", "Zebra"));

    const generalist = body.items.find((item) => item.name === "Generalist");
    expect(generalist).toMatchObject({
      name: "Generalist",
      description: "A plain assistant for simple factual and how-to questions.",
      perspective: "Answers the question directly, without a special stance.",
      voice: "Clear and short.",
      caresAbout: ["A correct, direct answer"],
      ignores: [],
      useWhen: ["Simple factual questions", "How-to questions with one right answer", "Greetings and small talk"],
      intensity: "subtle",
      createdBy: "user",
    });
    expect(generalist?.createdAt).toBe(generalist?.updatedAt);

    const reopened = createApp({
      databasePath: path.join(directory, "avatars.db"),
      corsOrigin: "http://localhost:5173",
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    try {
      const again = await reopened.app.request("/v1/avatars");
      const stored = (await again.json()) as { items: Avatar[] };
      expect(stored.items).toHaveLength(starterNames.length + 2);
      expect(stored.items.find((item) => item.name === "Generalist")?.createdAt).toBe(generalist?.createdAt);
    } finally {
      reopened.close();
    }
  });

  it("starts a library with avatars that answer in clearly different ways", () => {
    for (const name of ["Generalist", "Roast Master", "Software Engineer", "QA Tester", "Philosopher", "Psychiatrist"]) {
      expect(starterNames).toContain(name);
    }
    // Each starter must pass the same checks as an avatar a person creates.
    for (const starter of STARTER_AVATARS) {
      const checked = zAvatarCreateRequest.safeParse(starter);
      expect(checked.success, `${starter.name}: ${JSON.stringify(checked.error?.issues)}`).toBe(true);
      expect(starter.useWhen.length).toBeGreaterThan(0);
    }
    expect(new Set(starterNames.map((name) => name.toLowerCase())).size).toBe(starterNames.length);
    expect(new Set(STARTER_AVATARS.map((avatar) => avatar.intensity)).size).toBe(3);
  });

  it("does not bring a starter back after it is deleted", async () => {
    await deleteByName("Roast Master");
    reopen();
    expect(await listNames()).toEqual(withStarters().filter((name) => name !== "Roast Master"));
  });

  it("does not bring the starters back after every avatar is deleted", async () => {
    await postAvatar({ name: "Short lived" });
    for (const name of await listNames()) await deleteByName(name);
    expect(await listNames()).toEqual([]);

    reopen();
    expect(await listNames()).toEqual([]);

    reopen();
    expect(await listNames()).toEqual([]);
  });

  it("adds the starters to an older database and keeps what it holds", async () => {
    for (const name of await listNames()) await deleteByName(name);
    await postAvatar({ name: "Keeper" });
    const own = await postAvatar({ name: "roast master", voice: "My own roaster." });
    // A file written before the marker existed: rows, and a version of zero.
    withRawDatabase((raw) => raw.pragma("user_version = 0"));

    reopen();
    const expected = withStarters("Keeper").map((name) => (name === "Roast Master" ? "roast master" : name));
    expect(await listNames()).toEqual(expected);
    // The person's avatar with a starter's name is kept as it was, not replaced.
    const kept = await request(`/v1/avatars/${own.id}`);
    expect(((await kept.json()) as Avatar).voice).toBe("My own roaster.");
    expect(withRawDatabase((raw) => raw.pragma("user_version", { simple: true }))).toBe(1);

    for (const name of await listNames()) await deleteByName(name);
    reopen();
    expect(await listNames()).toEqual([]);
  });

  it.each([
    { script: "Cyrillic", stored: "Скептик", clash: "скептик", recased: "СКЕПТИК" },
    { script: "accented", stored: "Über Coach", clash: "über coach", recased: "ÜBER COACH" },
  ])("treats $script names that differ only by letter case as one name", async (names) => {
    const first = await postAvatar({ name: names.stored });

    const duplicate = await request("/v1/avatars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: names.clash, ...requiredFields }),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({
      type: "https://avatar.local/problems/name-taken",
      title: "Avatar name already in use",
      status: 409,
      detail: `An avatar named "${names.clash}" already exists.`,
    });

    const other = await postAvatar({ name: "Someone else" });
    const renamed = await patchAvatar(other.id, { name: names.clash });
    expect(renamed.status).toBe(409);
    expect(((await renamed.json()) as Problem).type).toBe(
      "https://avatar.local/problems/name-taken",
    );
    expect(await listNames()).toEqual([...withStarters("Someone else"), names.stored]);

    const recased = await patchAvatar(first.id, { name: names.recased });
    expect(recased.status).toBe(200);
    expect(((await recased.json()) as Avatar).name).toBe(names.recased);
  });

  it("treats a decomposed accent and a precomposed one as the same name", async () => {
    // Written as escapes so the two spellings of the accented letter stay distinct.
    await postAvatar({ name: "Caf\u00e9 Critic" });
    const duplicate = await request("/v1/avatars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "cafe\u0301 critic", ...requiredFields }),
    });
    expect(duplicate.status).toBe(409);
  });

  it("lets an avatar keep its name when older data already holds a clashing one", async () => {
    const first = await postAvatar({ name: "Скептик" });
    // Older versions accepted this second row: the column collation folds ASCII only.
    withRawDatabase((raw) =>
      raw
        .prepare(
          `INSERT INTO avatars
           SELECT ?, ?, description, perspective, voice, cares_about, ignores, use_when,
                  intensity, created_by, created_at, updated_at
           FROM avatars WHERE id = ?`,
        )
        .run(randomUUID(), "скептик", first.id),
    );

    const edited = await patchAvatar(first.id, { name: first.name, voice: "Dry." });
    expect(edited.status).toBe(200);
    expect((await edited.json()) as Avatar).toMatchObject({ name: first.name, voice: "Dry." });

    const other = await postAvatar({ name: "Someone else" });
    const renamed = await patchAvatar(other.id, { name: "СКЕПТИК" });
    expect(renamed.status).toBe(409);
  });

  it("asks for a JSON Content-Type instead of listing every field as missing", async () => {
    const wrongType = {
      type: "https://avatar.local/problems/validation-failed",
      title: "Request validation failed",
      status: 400,
      detail: "1 field is invalid.",
      errors: [{ field: "/", message: "Content-Type must be application/json." }],
    };
    const form = {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Form&voice=Plain",
    };
    // A byte body, unlike a string body, is sent without any Content-Type.
    const unlabelled = (value: unknown) => ({
      body: new TextEncoder().encode(JSON.stringify(value)),
    });
    const created = await postAvatar({ name: "Editable" });

    const attempts = [
      await request("/v1/avatars", { method: "POST", ...form }),
      await request("/v1/avatars", {
        method: "POST",
        ...unlabelled({ name: "Unlabelled", ...requiredFields }),
      }),
      await request(`/v1/avatars/${created.id}`, { method: "PATCH", ...form }),
      await request(`/v1/avatars/${created.id}`, {
        method: "PATCH",
        ...unlabelled({ voice: "Changed." }),
      }),
    ];
    for (const response of attempts) {
      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/problem+json");
      expect(await response.json()).toEqual(wrongType);
    }
    expect(await listNames()).toEqual(withStarters("Editable"));
    const unchanged = await request(`/v1/avatars/${created.id}`);
    expect(((await unchanged.json()) as Avatar).voice).toBe(requiredFields.voice);

    const badId = await request("/v1/avatars/not-a-uuid", { method: "PATCH", ...form });
    expect(badId.status).toBe(400);
    expect(((await badId.json()) as Problem).errors?.[0]?.field).toBe("/avatarId");

    const withParameters = await request("/v1/avatars", {
      method: "POST",
      headers: { "content-type": "Application/JSON; charset=utf-8" },
      body: JSON.stringify({ name: "Labelled", ...requiredFields }),
    });
    expect(withParameters.status).toBe(201);
  });

  it("returns problem details for invalid bodies, ids, and empty patches", async () => {
    const emptyCares = await request("/v1/avatars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Empty", ...requiredFields, caresAbout: [] }),
    });
    expect(emptyCares.status).toBe(400);
    expect(emptyCares.headers.get("content-type")).toContain("application/problem+json");
    expect(await emptyCares.json()).toEqual({
      type: "https://avatar.local/problems/validation-failed",
      title: "Request validation failed",
      status: 400,
      detail: "1 field is invalid.",
      errors: [{ field: "/caresAbout", message: "must contain at least 1 item" }],
    });

    const extra = await request("/v1/avatars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Extra", ...requiredFields, nickname: "nope" }),
    });
    const extraBody = (await extra.json()) as Problem;
    expect(extra.status).toBe(400);
    expect(extraBody.errors).toEqual([{ field: "/nickname", message: "is not allowed" }]);

    const duplicates = await request("/v1/avatars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dupes", ...requiredFields, caresAbout: ["Same", "Same"] }),
    });
    const duplicateBody = (await duplicates.json()) as Problem;
    expect(duplicates.status).toBe(400);
    expect(duplicateBody.errors).toEqual([{ field: "/caresAbout/1", message: "items must be unique" }]);

    const created = await postAvatar({ name: "Editable" });
    const emptyPatch = await request(`/v1/avatars/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(await emptyPatch.json()).toMatchObject({
      status: 400,
      errors: [{ field: "/", message: "must contain at least 1 field" }],
    });

    const createdBy = await request(`/v1/avatars/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ createdBy: "assistant" }),
    });
    const createdByBody = (await createdBy.json()) as Problem;
    expect(createdBy.status).toBe(400);
    expect(createdByBody.errors).toEqual([{ field: "/createdBy", message: "is not allowed" }]);

    const badId = await request("/v1/avatars/not-a-uuid");
    expect(badId.status).toBe(400);
    const badIdBody = (await badId.json()) as Problem;
    expect(badIdBody.type).toBe("https://avatar.local/problems/validation-failed");
    expect(badIdBody.errors?.[0]?.field).toBe("/avatarId");

    const malformed = await request("/v1/avatars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get("content-type")).toContain("application/problem+json");
  });

  it("reports liveness and allows the configured origin", async () => {
    const health = await request("/v1/health", {
      headers: { origin: "http://localhost:5173" },
    });
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(health.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");

    const unprefixed = await request("/health");
    expect(unprefixed.status).toBe(404);
    expect(unprefixed.headers.get("content-type")).toContain("application/problem+json");
  });

  it("trims text, rejects blank values, and compares trimmed names", async () => {
    const blank = await request("/v1/avatars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   ", ...requiredFields, caresAbout: [" "] }),
    });
    expect(blank.status).toBe(400);
    expect(((await blank.json()) as Problem).errors?.map((error) => error.field)).toEqual([
      "/name",
      "/caresAbout/0",
    ]);

    const padded = await postAvatar({ name: "  Padded  ", caresAbout: [" First ", "Second "] });
    expect(padded.name).toBe("Padded");
    expect(padded.caresAbout).toEqual(["First", "Second"]);

    const sameAfterTrim = await request("/v1/avatars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: " generalist", ...requiredFields }),
    });
    expect(sameAfterTrim.status).toBe(409);

    const duplicateAfterTrim = await request(`/v1/avatars/${padded.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ignores: ["Noise", " Noise"] }),
    });
    expect(duplicateAfterTrim.status).toBe(400);
    expect(((await duplicateAfterTrim.json()) as Problem).errors).toEqual([
      { field: "/ignores/1", message: "items must be unique" },
    ]);

    const blankPatch = await request(`/v1/avatars/${padded.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice: "  " }),
    });
    expect(blankPatch.status).toBe(400);
  });

  // Closes the service and starts it again on the same database file.
  function reopen(): void {
    close();
    const reopened = createApp({
      databasePath: path.join(directory, "avatars.db"),
      corsOrigin: "http://localhost:5173",
      now: () => now,
    });
    close = reopened.close;
    request = (input, init) => Promise.resolve(reopened.app.request(input, init));
  }

  function withRawDatabase<T>(use: (raw: Database.Database) => T): T {
    const raw = new Database(path.join(directory, "avatars.db"));
    try {
      return use(raw);
    } finally {
      raw.close();
    }
  }

  async function listNames(): Promise<string[]> {
    const listed = await request("/v1/avatars");
    return ((await listed.json()) as { items: Avatar[] }).items.map((item) => item.name);
  }

  async function deleteByName(name: string): Promise<void> {
    const listed = await request("/v1/avatars");
    const { items } = (await listed.json()) as { items: Avatar[] };
    const avatar = items.find((item) => item.name === name);
    const deleted = await request(`/v1/avatars/${avatar?.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
  }

  function patchAvatar(id: string, patch: Record<string, unknown>): Promise<Response> {
    return request(`/v1/avatars/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function postAvatar(extra: Record<string, unknown>): Promise<Avatar> {
    const response = await request("/v1/avatars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...requiredFields, ...extra }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as Avatar;
  }
});
