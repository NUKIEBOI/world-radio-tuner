import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Key/value store for directory bookkeeping (countries cache, fetched_at,
// last_error). The countries JSON snapshot is a cache of a public feed
// (Radio Browser), never user data.
export const directoryMeta = sqliteTable("directory_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Stations the user starred. Stores a snapshot of the station's Radio
// Browser fields (including the stream URL) so favorites keep working
// even before any directory fetch. Rows exist only when the user stars
// a station.
export const stationFavorites = sqliteTable("station_favorites", {
  uuid: text("uuid").primaryKey(),
  name: text("name").notNull(),
  streamUrl: text("stream_url").notNull(),
  homepage: text("homepage").notNull(),
  country: text("country").notNull(),
  countryCode: text("country_code").notNull(),
  state: text("state").notNull(),
  tags: text("tags").notNull(),
  codec: text("codec").notNull(),
  bitrate: integer("bitrate").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
