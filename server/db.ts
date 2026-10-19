import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

// Standalone SQLite database. Tables are created on first boot from the
// drizzle schema (same shape as the drizzle/ migrations).
const sqlite = new Database(process.env.TUNER_DB ?? "tuner.db");
sqlite.exec("PRAGMA journal_mode = WAL;");

export const db = drizzle(sqlite, { schema });

sqlite.exec(`
CREATE TABLE IF NOT EXISTS directory_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS station_favorites (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stream_url TEXT NOT NULL,
  homepage TEXT NOT NULL,
  country TEXT NOT NULL,
  country_code TEXT NOT NULL,
  state TEXT NOT NULL,
  tags TEXT NOT NULL,
  codec TEXT NOT NULL,
  bitrate INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`);
