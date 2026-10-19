DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE receivers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  url TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  users INTEGER,
  users_max INTEGER,
  antenna TEXT NOT NULL,
  bands TEXT NOT NULL,
  type TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE directory_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE favorites (
  receiver_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE log_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station TEXT NOT NULL,
  freq_khz REAL NOT NULL,
  mode TEXT NOT NULL,
  receiver_name TEXT NOT NULL,
  listened_at INTEGER NOT NULL,
  notes TEXT NOT NULL,
  rating INTEGER,
  created_at INTEGER NOT NULL
);
