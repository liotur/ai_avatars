import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { zAvatar } from "@avatars/contracts/avatar/zod";
import Database from "better-sqlite3";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { avatars, createAvatarsSql } from "./schema.js";
import type { Avatar } from "./types.js";
import type { AvatarCreateBody, AvatarUpdateBody } from "./validation.js";

const generalist = {
  name: "Generalist",
  description: "A plain assistant for simple factual and how-to questions.",
  perspective: "Answers the question directly, without a special stance.",
  voice: "Clear and short.",
  caresAbout: ["A correct, direct answer"],
  ignores: [] as string[],
  useWhen: ["Simple factual questions", "How-to questions with one right answer"],
  intensity: "subtle" as const,
  createdBy: "user" as const,
};

export type CreateResult =
  | { ok: true; avatar: Avatar }
  | { ok: false; reason: "name-taken"; name: string };

export type UpdateResult =
  | { ok: true; avatar: Avatar }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "name-taken"; name: string };

export type AvatarStore = {
  list: () => Avatar[];
  findById: (id: string) => Avatar | undefined;
  create: (input: AvatarCreateBody) => CreateResult;
  update: (id: string, patch: AvatarUpdateBody) => UpdateResult;
  remove: (id: string) => boolean;
  close: () => void;
};

export type OpenDatabaseOptions = {
  databasePath: string;
  now?: () => Date;
};

export function openDatabase(options: OpenDatabaseOptions): AvatarStore {
  const now = options.now ?? (() => new Date());
  mkdirSync(path.dirname(options.databasePath), { recursive: true });

  const sqlite = new Database(options.databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(createAvatarsSql);

  const db = drizzle(sqlite, { schema: { avatars } });

  db.transaction((tx) => {
    const row = tx.select({ n: count() }).from(avatars).get();
    if (Number(row?.n ?? 0) > 0) return;
    const timestamp = now().toISOString();
    tx.insert(avatars)
      .values({
        id: randomUUID(),
        ...generalist,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  });

  function findRowById(id: string) {
    return db.select().from(avatars).where(eq(avatars.id, normalizeId(id))).get();
  }

  function findRowByName(name: string) {
    return db
      .select()
      .from(avatars)
      .where(sql`${avatars.name} = ${name} COLLATE NOCASE`)
      .get();
  }

  return {
    list() {
      return db
        .select()
        .from(avatars)
        .orderBy(sql`${avatars.name} COLLATE NOCASE`, avatars.id)
        .all()
        .map(toAvatar);
    },

    findById(id) {
      const row = findRowById(id);
      return row ? toAvatar(row) : undefined;
    },

    create(input) {
      if (findRowByName(input.name)) {
        return { ok: false, reason: "name-taken", name: input.name };
      }
      const timestamp = now().toISOString();
      const id = randomUUID();
      try {
        db.insert(avatars)
          .values({
            id,
            name: input.name,
            description: input.description,
            perspective: input.perspective,
            voice: input.voice,
            caresAbout: input.caresAbout,
            ignores: input.ignores,
            useWhen: input.useWhen,
            intensity: input.intensity,
            createdBy: input.createdBy,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .run();
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false, reason: "name-taken", name: input.name };
        }
        throw error;
      }
      const stored = findRowById(id);
      if (!stored) {
        throw new Error("Insert succeeded but the avatar could not be read back.");
      }
      return { ok: true, avatar: toAvatar(stored) };
    },

    update(id, patch) {
      const current = findRowById(id);
      if (!current) return { ok: false, reason: "not-found" };
      if (patch.name !== undefined) {
        const existing = findRowByName(patch.name);
        if (existing && existing.id !== normalizeId(id)) {
          return { ok: false, reason: "name-taken", name: patch.name };
        }
      }

      try {
        db.update(avatars)
          .set({
            updatedAt: now().toISOString(),
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.perspective !== undefined ? { perspective: patch.perspective } : {}),
            ...(patch.voice !== undefined ? { voice: patch.voice } : {}),
            ...(patch.caresAbout !== undefined ? { caresAbout: patch.caresAbout } : {}),
            ...(patch.ignores !== undefined ? { ignores: patch.ignores } : {}),
            ...(patch.useWhen !== undefined ? { useWhen: patch.useWhen } : {}),
            ...(patch.intensity !== undefined ? { intensity: patch.intensity } : {}),
          })
          .where(eq(avatars.id, normalizeId(id)))
          .run();
      } catch (error) {
        if (isUniqueViolation(error) && patch.name !== undefined) {
          return { ok: false, reason: "name-taken", name: patch.name };
        }
        throw error;
      }

      const stored = findRowById(id);
      if (!stored) {
        throw new Error("Update succeeded but the avatar could not be read back.");
      }
      return { ok: true, avatar: toAvatar(stored) };
    },

    remove(id) {
      const result = db.delete(avatars).where(eq(avatars.id, normalizeId(id))).run();
      return result.changes > 0;
    },

    close() {
      sqlite.close();
    },
  };
}

function toAvatar(row: typeof avatars.$inferSelect): Avatar {
  return zAvatar.parse(row);
}

function normalizeId(id: string): string {
  return id.toLowerCase();
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  return code === "SQLITE_CONSTRAINT_UNIQUE";
}
