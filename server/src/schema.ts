import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Cached snapshot of the public KiwiSDR / WebSDR receiver directory.
// Rows are replaced wholesale by the refreshReceivers action; this is a
// cache of a public feed, never user data.
export const receivers = sqliteTable("receivers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  url: text("url").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  users: integer("users"),
  usersMax: integer("users_max"),
  antenna: text("antenna").notNull(),
  bands: text("bands").notNull(),
  type: text("type", { enum: ["KiwiSDR", "WebSDR"] }).notNull(),
});

// Key/value store for directory bookkeeping (fetched_at, last_error).
export const directoryMeta = sqliteTable("directory_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Receivers the user starred.
export const favorites = sqliteTable("favorites", {
  receiverId: text("receiver_id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The user's own listening log ("record what you catch"). Starts empty;
// rows exist only when the user adds them.
export const logEntries = sqliteTable("log_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  station: text("station").notNull(),
  freqKhz: real("freq_khz").notNull(),
  mode: text("mode").notNull(),
  receiverName: text("receiver_name").notNull(),
  listenedAt: integer("listened_at", { mode: "timestamp_ms" }).notNull(),
  notes: text("notes").notNull(),
  rating: integer("rating"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
