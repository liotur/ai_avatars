import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { zAvatar } from "@avatars/contracts/avatar/zod";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { avatars, createAvatarsSql } from "./schema.js";
import { STARTER_AVATARS } from "./starters.js";
import type { Avatar } from "./types.js";
import type { AvatarCreateBody, AvatarUpdateBody } from "./validation.js";

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

type AvatarDatabase = BetterSQLite3Database<{ avatars: typeof avatars }>;

// A transaction reads the same way the database does.
type Reader = Pick<AvatarDatabase, "select">;

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

  seedOnce(sqlite, db, now);

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
      const row = findRowById(db, id);
      return row ? toAvatar(row) : undefined;
    },

    create(input) {
      try {
        // The name check and the insert share one transaction, so no other
        // write can land between them.
        return db.transaction((tx): CreateResult => {
          if (nameKeyInUse(tx, nameKey(input.name))) {
            return { ok: false, reason: "name-taken", name: input.name };
          }
          const timestamp = now().toISOString();
          const id = randomUUID();
          tx.insert(avatars)
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
          const stored = findRowById(tx, id);
          if (!stored) {
            throw new Error("Insert succeeded but the avatar could not be read back.");
          }
          return { ok: true, avatar: toAvatar(stored) };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false, reason: "name-taken", name: input.name };
        }
        throw error;
      }
    },

    update(id, patch) {
      try {
        return db.transaction((tx): UpdateResult => {
          const current = findRowById(tx, id);
          if (!current) return { ok: false, reason: "not-found" };
          if (patch.name !== undefined) {
            const key = nameKey(patch.name);
            // An avatar keeping its own name, in any letter case, is not a clash.
            if (key !== nameKey(current.name) && nameKeyInUse(tx, key)) {
              return { ok: false, reason: "name-taken", name: patch.name };
            }
          }

          tx.update(avatars)
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

          const stored = findRowById(tx, id);
          if (!stored) {
            throw new Error("Update succeeded but the avatar could not be read back.");
          }
          return { ok: true, avatar: toAvatar(stored) };
        });
      } catch (error) {
        if (isUniqueViolation(error) && patch.name !== undefined) {
          return { ok: false, reason: "name-taken", name: patch.name };
        }
        throw error;
      }
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

// The starter set this code gives a database. Raise it when the set changes.
const STARTER_VERSION = 1;

// user_version records that a database has received the starter avatars, so
// they are added once. Without it, a person who deletes one would get it back
// on the next start. A database that already holds avatars gets the starters
// whose names are still free, and keeps everything it has.
function seedOnce(sqlite: Database.Database, db: AvatarDatabase, now: () => Date): void {
  if (Number(sqlite.pragma("user_version", { simple: true })) >= STARTER_VERSION) return;
  db.transaction((tx) => {
    const timestamp = now().toISOString();
    for (const starter of STARTER_AVATARS) {
      if (nameKeyInUse(tx, nameKey(starter.name))) continue;
      tx.insert(avatars)
        .values({ id: randomUUID(), ...starter, createdAt: timestamp, updatedAt: timestamp })
        .run();
    }
    // Written inside the transaction, so it is kept or undone with the rows.
    sqlite.pragma(`user_version = ${STARTER_VERSION}`);
  });
}

function findRowById(reader: Reader, id: string) {
  return reader.select().from(avatars).where(eq(avatars.id, normalizeId(id))).get();
}

// The NOCASE collation on the name column folds ASCII letters only, so names
// in other scripts are compared on this key instead.
function nameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase();
}

function nameKeyInUse(reader: Reader, key: string): boolean {
  const rows = reader.select({ name: avatars.name }).from(avatars).all();
  return rows.some((row) => nameKey(row.name) === key);
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
