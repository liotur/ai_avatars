import type { CreatedBy, Intensity } from "./types.js";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const avatars = sqliteTable("avatars", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  perspective: text("perspective").notNull(),
  voice: text("voice").notNull(),
  caresAbout: text("cares_about", { mode: "json" }).$type<string[]>().notNull(),
  ignores: text("ignores", { mode: "json" }).$type<string[]>().notNull(),
  useWhen: text("use_when", { mode: "json" }).$type<string[]>().notNull(),
  intensity: text("intensity").$type<Intensity>().notNull(),
  createdBy: text("created_by").$type<CreatedBy>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const createAvatarsSql = `
CREATE TABLE IF NOT EXISTS avatars (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL,
  perspective TEXT NOT NULL,
  voice TEXT NOT NULL,
  cares_about TEXT NOT NULL,
  ignores TEXT NOT NULL,
  use_when TEXT NOT NULL,
  intensity TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS avatars_name_nocase ON avatars (name COLLATE NOCASE);
`;
