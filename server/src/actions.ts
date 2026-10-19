// Actions for the World Radio Tuner (globe edition).
//
// Station data comes from Radio Browser (radio-browser.info), the free
// community-run directory of internet radio stations. The server side
// only handles the directory: the country list (cached in the DB), the
// station list for one country, name search, and the user's favorite
// stations. Audio itself streams straight from each station's own
// server to the listener's browser — nothing is relayed through here.
//
// Directory mirrors: de1.api.radio-browser.info is primary,
// de2.api.radio-browser.info is the fallback (both verified reachable
// 2026-10-19; nl1 did not answer).

import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { asc } from "drizzle-orm";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

const API_HOSTS = [
  "de1.api.radio-browser.info",
  "de2.api.radio-browser.info",
];
const USER_AGENT = "WorldRadioTuner/2.0 (Muse web artifact)";
const COUNTRIES_TTL_MS = 6 * 60 * 60 * 1000;

async function fetchRadioBrowser(path: string): Promise<unknown> {
  let lastError: Error | null = null;
  for (const host of API_HOSTS) {
    try {
      const res = await fetch(`https://${host}${path}`, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Radio Browser HTTP ${res.status}`);
      return (await res.json()) as unknown;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("directory fetch failed");
    }
  }
  throw lastError ?? new Error("directory fetch failed");
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

// ---------- Radio Browser row shapes (only the fields we consume) ----------

interface RbCountry {
  name?: unknown;
  iso_3166_1?: unknown;
  stationcount?: unknown;
}

interface RbStation {
  stationuuid?: unknown;
  name?: unknown;
  url_resolved?: unknown;
  url?: unknown;
  homepage?: unknown;
  country?: unknown;
  countrycode?: unknown;
  state?: unknown;
  language?: unknown;
  tags?: unknown;
  codec?: unknown;
  bitrate?: unknown;
  votes?: unknown;
  hls?: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const stationOut = z.object({
  uuid: z.string(),
  name: z.string(),
  stream_url: z.string(),
  homepage: z.string(),
  country: z.string(),
  country_code: z.string(),
  state: z.string(),
  language: z.string(),
  tags: z.array(z.string()),
  codec: z.string(),
  bitrate: z.number(),
  votes: z.number(),
  https: z.boolean(),
});

type StationOut = z.infer<typeof stationOut>;

function normalizeStation(row: RbStation): StationOut | null {
  const uuid = str(row.stationuuid);
  const name = str(row.name);
  const streamUrl = str(row.url_resolved) || str(row.url);
  if (!uuid || !name || !streamUrl) return null;
  // HLS streams (.m3u8) need a special player; plain MP3/AAC/OGG streams
  // play directly in the browser, so HLS entries are left out.
  if (num(row.hls) === 1 || streamUrl.includes(".m3u8")) return null;
  const tags = str(row.tags)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 4);
  return {
    uuid,
    name,
    stream_url: streamUrl,
    homepage: str(row.homepage),
    country: str(row.country),
    country_code: str(row.countrycode).toUpperCase(),
    state: str(row.state),
    language: str(row.language),
    tags,
    codec: str(row.codec) || "?",
    bitrate: num(row.bitrate),
    votes: num(row.votes),
    https: streamUrl.toLowerCase().startsWith("https://"),
  };
}

// HTTPS streams first (an https page cannot play http:// audio — the
// browser blocks it as mixed content), then by community votes.
function rankStations(stations: StationOut[]): StationOut[] {
  return [...stations].sort((a, b) => {
    if (a.https !== b.https) return a.https ? -1 : 1;
    return b.votes - a.votes;
  });
}

function normalizeStations(data: unknown, limit: number): StationOut[] {
  if (!Array.isArray(data)) return [];
  const out: StationOut[] = [];
  for (const row of data as RbStation[]) {
    const station = normalizeStation(row);
    if (station) out.push(station);
  }
  return rankStations(out).slice(0, limit);
}

// ---------- Response schemas ----------

const countriesResponse = z.object({
  countries: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      station_count: z.number(),
    }),
  ),
  fetched_at: z.string().nullable(),
  error: z.string().nullable(),
});

const stationsResponse = z.object({
  stations: z.array(stationOut),
  error: z.string().nullable(),
});

const favoritesResponse = z.object({
  favorites: z.array(stationOut),
});

const okResponse = z.object({ ok: z.literal(true) });

const stationSnapshot = {
  uuid: z.string().min(1).max(100),
  name: z.string().min(1).max(300),
  streamUrl: z.string().min(1).max(2000),
  homepage: z.string().max(2000),
  country: z.string().max(200),
  countryCode: z.string().max(10),
  state: z.string().max(200),
  tags: z.array(z.string().max(100)).max(8),
  codec: z.string().max(50),
  bitrate: z.number().int().min(0).max(100000),
};

export const Actions = {
  // Country list with live station counts. Cached in the DB for 6 hours;
  // a failed refresh keeps serving the last good snapshot and says so.
  getCountries: defineAction({
    request: z.object({ force: z.boolean().optional() }),
    response: countriesResponse,
    async handler(ctx, args): Promise<z.infer<typeof countriesResponse>> {
      const meta = await readMeta(ctx);
      const cachedRaw = meta["countries_json"];
      const cachedAt = meta["countries_fetched_at"] ?? null;
      const fresh =
        cachedAt !== null &&
        Date.now() - new Date(cachedAt).getTime() < COUNTRIES_TTL_MS;
      if (cachedRaw && fresh && !args.force) {
        return {
          countries: JSON.parse(cachedRaw) as z.infer<
            typeof countriesResponse
          >["countries"],
          fetched_at: cachedAt,
          error: null,
        };
      }
      try {
        const data = await fetchRadioBrowser(
          "/json/countries?order=stationcount&reverse=true&hidebroken=true",
        );
        if (!Array.isArray(data)) {
          throw new Error("country list was not an array");
        }
        const countries = (data as RbCountry[])
          .map((row) => ({
            code: str(row.iso_3166_1).toUpperCase(),
            name: str(row.name),
            station_count: num(row.stationcount),
          }))
          .filter((c) => /^[A-Z]{2}$/.test(c.code) && c.station_count > 0);
        if (countries.length < 50) {
          throw new Error(
            `country list returned only ${countries.length} usable countries`,
          );
        }
        const fetchedAt = new Date().toISOString();
        await setMeta(ctx, {
          countries_json: JSON.stringify(countries),
          countries_fetched_at: fetchedAt,
          countries_error: "",
        });
        ctx.invalidateQueries();
        return { countries, fetched_at: fetchedAt, error: null };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "directory fetch failed";
        await setMeta(ctx, { countries_error: message });
        ctx.invalidateQueries();
        if (cachedRaw) {
          return {
            countries: JSON.parse(cachedRaw) as z.infer<
              typeof countriesResponse
            >["countries"],
            fetched_at: cachedAt,
            error: message,
          };
        }
        return { countries: [], fetched_at: null, error: message };
      }
    },
  }),

  // Top stations for one country, optionally narrowed to one genre tag.
  getStations: defineAction({
    request: z.object({
      countryCode: z
        .string()
        .regex(/^[A-Za-z]{2}$/, "countryCode must be an ISO alpha-2 code"),
      genre: z.string().max(60).optional(),
    }),
    response: stationsResponse,
    async handler(ctx, args): Promise<z.infer<typeof stationsResponse>> {
      void ctx;
      const code = args.countryCode.toUpperCase();
      const genre = (args.genre ?? "").trim();
      const path = genre
        ? `/json/stations/search?countrycode=${code}&tag=${encodeURIComponent(genre)}&order=votes&reverse=true&hidebroken=true&limit=48`
        : `/json/stations/bycountrycodeexact/${code}?order=votes&reverse=true&hidebroken=true&limit=48`;
      try {
        const data = await fetchRadioBrowser(path);
        return { stations: normalizeStations(data, 40), error: null };
      } catch (error) {
        return {
          stations: [],
          error:
            error instanceof Error
              ? error.message
              : "station fetch failed",
        };
      }
    },
  }),

  // Free-text station search across every country.
  searchStations: defineAction({
    request: z.object({ query: z.string().min(2).max(100) }),
    response: stationsResponse,
    async handler(ctx, args): Promise<z.infer<typeof stationsResponse>> {
      void ctx;
      const path = `/json/stations/search?name=${encodeURIComponent(args.query.trim())}&order=votes&reverse=true&hidebroken=true&limit=36`;
      try {
        const data = await fetchRadioBrowser(path);
        return { stations: normalizeStations(data, 30), error: null };
      } catch (error) {
        return {
          stations: [],
          error:
            error instanceof Error ? error.message : "station search failed",
        };
      }
    },
  }),

  getFavorites: defineAction({
    request: z.object({}),
    response: favoritesResponse,
    async handler(ctx): Promise<z.infer<typeof favoritesResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.stationFavorites)
        .orderBy(asc(schema.stationFavorites.name));
      return {
        favorites: rows.map((r) => ({
          uuid: r.uuid,
          name: r.name,
          stream_url: r.streamUrl,
          homepage: r.homepage,
          country: r.country,
          country_code: r.countryCode,
          state: r.state,
          language: "",
          tags: r.tags ? r.tags.split(",").filter(Boolean) : [],
          codec: r.codec,
          bitrate: r.bitrate,
          votes: 0,
          https: r.streamUrl.toLowerCase().startsWith("https://"),
        })),
      };
    },
  }),

  toggleStationFavorite: defineAction({
    request: z.object({
      favorite: z.boolean(),
      station: z.object(stationSnapshot),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      if (args.favorite) {
        await db
          .insert(schema.stationFavorites)
          .values({
            uuid: args.station.uuid,
            name: args.station.name,
            streamUrl: args.station.streamUrl,
            homepage: args.station.homepage,
            country: args.station.country,
            countryCode: args.station.countryCode,
            state: args.station.state,
            tags: args.station.tags.join(","),
            codec: args.station.codec,
            bitrate: args.station.bitrate,
          })
          .onConflictDoNothing();
      } else {
        await db
          .delete(schema.stationFavorites)
          .where(eq(schema.stationFavorites.uuid, args.station.uuid));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;
