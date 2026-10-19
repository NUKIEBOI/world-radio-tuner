// Actions for the World Radio Tuner.
//
// The receiver directory comes from the public KiwiSDR listing. The
// canonical list at kiwisdr.com/public/ sits behind a JavaScript bot
// check, so we read the linkfanel (dyatlov) mirror files, which are
// regenerated from kiwisdr.com data and republish the same dataset:
//   - kiwisdr_com.js : every public KiwiSDR (name, location, GPS,
//     listener count / capacity, antenna, bands, URL)
//   - static_rx.js   : a small curated set of WebSDR receivers
// The snapshot is cached in the DB and refreshed on demand; if a fetch
// fails we keep serving the last good snapshot and report the error.

import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { asc, desc, eq } from "drizzle-orm";
import * as schema from "./schema";

const KIWI_FEED_URL = "http://rx.linkfanel.net/kiwisdr_com.js";
const WEBSDR_FEED_URL = "http://rx.linkfanel.net/static_rx.js";

type ReceiverRow = typeof schema.receivers.$inferInsert;

// The feed files are JS data files (`var name = [ {...}, {...}, ];`)
// with trailing commas, so extract the array literal and normalize it
// before JSON.parse.
function parseFeedArray(text: string): Record<string, unknown>[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error("feed did not contain a data array");
  }
  const cleaned = text
    .slice(start, end + 1)
    .replace(/,\s*([}\]])/g, "$1");
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) {
    throw new Error("feed data was not an array");
  }
  return parsed.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null,
  );
}

// The curated WebSDR file (static_rx.js) is a loose JS literal —
// unquoted keys, single-quoted strings — so it needs a lenient pass:
// quote the keys and convert single-quoted strings, then JSON.parse.
function parseFeedArrayLenient(text: string): Record<string, unknown>[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error("feed did not contain a data array");
  }
  const converted = text
    .slice(start, end + 1)
    .replace(/'((?:[^'\\]|\\.)*)'/g, (_m, inner: string) =>
      JSON.stringify(inner.replace(/\\'/g, "'")),
    )
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, "$1");
  const parsed: unknown = JSON.parse(converted);
  if (!Array.isArray(parsed)) {
    throw new Error("feed data was not an array");
  }
  return parsed.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null,
  );
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function intOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Feed GPS format: "(59.546000, 12.526000)".
function parseGps(value: unknown): { lat: number; lon: number } | null {
  const raw = str(value);
  const match = raw.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

function normalizeKiwi(row: Record<string, unknown>): ReceiverRow | null {
  if (str(row.offline) === "yes") return null;
  const url = str(row.url);
  const gps = parseGps(row.gps);
  if (!url || !gps) return null;
  const id = str(row.id) || url;
  return {
    id: `kiwi:${id}`,
    name: str(row.name) || url,
    location: str(row.loc) || str(row.name),
    url,
    lat: gps.lat,
    lon: gps.lon,
    users: intOrNull(row.users),
    usersMax: intOrNull(row.users_max),
    antenna: str(row.antenna),
    bands: str(row.bands),
    type: "KiwiSDR",
  };
}

function normalizeWebSdr(row: Record<string, unknown>): ReceiverRow | null {  const url = str(row.url);
  const gps = parseGps(row.gps);
  if (!url || !gps) return null;
  return {
    id: `websdr:${url}`,
    name: str(row.name) || url,
    location: str(row.name),
    url,
    lat: gps.lat,
    lon: gps.lon,
    users: null,
    usersMax: intOrNull(row.users_max),
    antenna: str(row.antenna),
    bands: str(row.bands),
    type: "WebSDR",
  };
}

async function fetchFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "WorldRadioTuner/1.0 (Muse web artifact)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`feed fetch failed: HTTP ${res.status}`);
  }
  return res.text();
}

async function setMeta(
  ctx: Ctx,
  entries: Record<string, string>,
): Promise<void> {
  const db = ctx.db<typeof schema>();
  for (const [key, value] of Object.entries(entries)) {
    await db
      .insert(schema.directoryMeta)
      .values({ key, value })
      .onConflictDoUpdate({
        target: schema.directoryMeta.key,
        set: { value },
      });
  }
}

async function readMeta(ctx: Ctx): Promise<Record<string, string>> {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.directoryMeta);
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

const receiverOut = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string(),
  url: z.string(),
  lat: z.number(),
  lon: z.number(),
  users: z.number().nullable(),
  users_max: z.number().nullable(),
  antenna: z.string(),
  bands: z.string(),
  type: z.enum(["KiwiSDR", "WebSDR"]),
});

const logEntryOut = z.object({
  id: z.number(),
  station: z.string(),
  freq_khz: z.number(),
  mode: z.string(),
  receiver_name: z.string(),
  listened_at: z.string(),
  notes: z.string(),
  rating: z.number().nullable(),
});

const stateResponse = z.object({
  receivers: z.array(receiverOut),
  favorites: z.array(z.string()),
  log: z.array(logEntryOut),
  meta: z.object({
    fetched_at: z.string().nullable(),
    last_error: z.string().nullable(),
  }),
});

const refreshResponse = z.object({
  ok: z.boolean(),
  count: z.number(),
  fetched_at: z.string().nullable(),
  error: z.string().nullable(),
});

const okResponse = z.object({ ok: z.literal(true) });

const logFields = {
  station: z.string().min(1).max(200),
  freqKhz: z.number().positive().max(30000),
  mode: z.string().min(1).max(10),
  receiverName: z.string().max(200),
  listenedAt: z.string().min(1),
  notes: z.string().max(2000),
  rating: z.number().int().min(1).max(5).nullable(),
};

export const Actions = {
  getState: defineAction({
    request: z.object({}),
    response: stateResponse,
    async handler(ctx): Promise<z.infer<typeof stateResponse>> {
      const db = ctx.db<typeof schema>();
      const [receiverRows, favoriteRows, logRows, meta] = await Promise.all([
        db.select().from(schema.receivers).orderBy(asc(schema.receivers.name)),
        db.select().from(schema.favorites),
        db
          .select()
          .from(schema.logEntries)
          .orderBy(desc(schema.logEntries.listenedAt)),
        readMeta(ctx),
      ]);
      return {
        receivers: receiverRows.map((r) => ({
          id: r.id,
          name: r.name,
          location: r.location,
          url: r.url,
          lat: r.lat,
          lon: r.lon,
          users: r.users,
          users_max: r.usersMax,
          antenna: r.antenna,
          bands: r.bands,
          type: r.type,
        })),
        favorites: favoriteRows.map((f) => f.receiverId),
        log: logRows.map((e) => ({
          id: e.id,
          station: e.station,
          freq_khz: e.freqKhz,
          mode: e.mode,
          receiver_name: e.receiverName,
          listened_at: e.listenedAt.toISOString(),
          notes: e.notes,
          rating: e.rating,
        })),
        meta: {
          fetched_at: meta["fetched_at"] ?? null,
          last_error: meta["last_error"] ?? null,
        },
      };
    },
  }),

  refreshReceivers: defineAction({
    request: z.object({}),
    response: refreshResponse,
    async handler(ctx): Promise<z.infer<typeof refreshResponse>> {
      const db = ctx.db<typeof schema>();
      try {
        const [kiwiText, websdrText] = await Promise.all([
          fetchFeed(KIWI_FEED_URL),
          fetchFeed(WEBSDR_FEED_URL).catch(() => ""),
        ]);
        const byUrl = new Map<string, ReceiverRow>();
        for (const row of parseFeedArray(kiwiText)) {
          const normalized = normalizeKiwi(row);
          if (normalized) byUrl.set(normalized.url, normalized);
        }
        if (websdrText) {
          // The WebSDR list is a bonus on top of the Kiwi directory —
          // never let a parse problem with it block the refresh.
          let websdrRows: Record<string, unknown>[] = [];
          try {
            websdrRows = parseFeedArrayLenient(websdrText);
          } catch {
            websdrRows = [];
          }
          for (const row of websdrRows) {
            const normalized = normalizeWebSdr(row);
            if (normalized && !byUrl.has(normalized.url)) {
              byUrl.set(normalized.url, normalized);
            }
          }
        }
        const rows = [...byUrl.values()];
        if (rows.length < 50) {
          throw new Error(
            `directory feed returned only ${rows.length} usable receivers`,
          );
        }
        const fetchedAt = new Date().toISOString();
        await db.delete(schema.receivers);
        // Insert in chunks so one batch call stays a reasonable size.
        for (let i = 0; i < rows.length; i += 100) {
          await db.insert(schema.receivers).values(rows.slice(i, i + 100));
        }
        await setMeta(ctx, { fetched_at: fetchedAt, last_error: "" });
        ctx.invalidateQueries();
        return { ok: true, count: rows.length, fetched_at: fetchedAt, error: null };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "directory fetch failed";
        const meta = await readMeta(ctx);
        await setMeta(ctx, { last_error: message });
        ctx.invalidateQueries();
        return {
          ok: false,
          count: 0,
          fetched_at: meta["fetched_at"] ?? null,
          error: message,
        };
      }
    },
  }),

  toggleFavorite: defineAction({
    request: z.object({
      receiverId: z.string().min(1),
      favorite: z.boolean(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      if (args.favorite) {
        await db
          .insert(schema.favorites)
          .values({ receiverId: args.receiverId })
          .onConflictDoNothing();
      } else {
        await db
          .delete(schema.favorites)
          .where(eq(schema.favorites.receiverId, args.receiverId));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  addLogEntry: defineAction({
    request: z.object(logFields),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const listenedAt = new Date(args.listenedAt);
      if (Number.isNaN(listenedAt.getTime())) {
        throw new Error("listenedAt is not a valid date");
      }
      const result = await db
        .insert(schema.logEntries)
        .values({
          station: args.station,
          freqKhz: args.freqKhz,
          mode: args.mode,
          receiverName: args.receiverName,
          listenedAt,
          notes: args.notes,
          rating: args.rating,
        })
        .returning({ id: schema.logEntries.id });
      const inserted = result[0];
      if (!inserted) throw new Error("addLogEntry: insert returned no rows");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateLogEntry: defineAction({
    request: z.object({ id: z.number().int().positive(), ...logFields }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const listenedAt = new Date(args.listenedAt);
      if (Number.isNaN(listenedAt.getTime())) {
        throw new Error("listenedAt is not a valid date");
      }
      await db
        .update(schema.logEntries)
        .set({
          station: args.station,
          freqKhz: args.freqKhz,
          mode: args.mode,
          receiverName: args.receiverName,
          listenedAt,
          notes: args.notes,
          rating: args.rating,
        })
        .where(eq(schema.logEntries.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteLogEntry: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.logEntries)
        .where(eq(schema.logEntries.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;
