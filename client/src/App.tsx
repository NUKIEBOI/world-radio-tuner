import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";
import { COUNTRY_GEO } from "./geo";
import { GlobeMap, type GlobePlace } from "./GlobeMap";

type CountriesState = ApiResponse<typeof api, "getCountries">;
type Country = CountriesState["countries"][number];
type Station = ApiResponse<typeof api, "getStations">["stations"][number];

type PlayStatus = "idle" | "connecting" | "playing" | "paused" | "error";

type PanelView =
  | { kind: "country"; code: string; genre: string }
  | { kind: "search"; query: string }
  | null;

const GENRES = [
  "pop",
  "rock",
  "jazz",
  "classical",
  "electronic",
  "dance",
  "hip-hop",
  "latin",
  "country",
  "folk",
  "world",
  "reggae",
  "blues",
  "metal",
] as const;

const CONNECT_TIMEOUT_MS = 12_000;

function displayName(country: Country): string {
  // Radio Browser has a couple of pseudo-codes (XX, UN) with no name at
  // all — fall back to the code rather than rendering a blank row.
  return COUNTRY_GEO[country.code]?.name || country.name || country.code;
}

function stationSnapshot(s: Station) {
  return {
    uuid: s.uuid,
    name: s.name,
    streamUrl: s.stream_url,
    homepage: s.homepage,
    country: s.country,
    countryCode: s.country_code,
    state: s.state,
    tags: s.tags,
    codec: s.codec,
    bitrate: s.bitrate,
  };
}

function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function App() {
  const queryClient = useQueryClient();

  const countriesQuery = useQuery({
    queryKey: ["countries"],
    queryFn: () => api.getCountries({}),
  });
  const favoritesQuery = useQuery({
    queryKey: ["favorites"],
    queryFn: () => api.getFavorites({}),
  });

  const countries = useMemo(
    () => countriesQuery.data?.countries ?? [],
    [countriesQuery.data],
  );
  const totalStations = useMemo(
    () => countries.reduce((sum, c) => sum + c.station_count, 0),
    [countries],
  );
  const favorites = useMemo(
    () => favoritesQuery.data?.favorites ?? [],
    [favoritesQuery.data],
  );
  const favoriteUuids = useMemo(
    () => new Set(favorites.map((f) => f.uuid)),
    [favorites],
  );

  const [globeAvailable, setGlobeAvailable] = useState(true);
  const [countrySearch, setCountrySearch] = useState("");
  const [stationSearch, setStationSearch] = useState("");
  const [view, setView] = useState<PanelView>(null);

  // ---------- station panel data ----------
  const panelCountryCode =
    view?.kind === "country" ? view.code : null;
  const panelGenre = view?.kind === "country" ? view.genre : "";
  const stationsQuery = useQuery({
    queryKey: ["stations", panelCountryCode, panelGenre],
    queryFn: () =>
      api.getStations({
        countryCode: panelCountryCode ?? "",
        genre: panelGenre || undefined,
      }),
    enabled: panelCountryCode !== null,
  });
  const searchQueryText = view?.kind === "search" ? view.query : null;
  const searchQuery = useQuery({
    queryKey: ["search", searchQueryText],
    queryFn: () => api.searchStations({ query: searchQueryText ?? "" }),
    enabled: searchQueryText !== null,
  });

  const panelStations: Station[] =
    view?.kind === "country"
      ? (stationsQuery.data?.stations ?? [])
      : view?.kind === "search"
        ? (searchQuery.data?.stations ?? [])
        : [];
  const panelLoading =
    view?.kind === "country"
      ? stationsQuery.isPending
      : view?.kind === "search"
        ? searchQuery.isPending
        : false;
  const panelError =
    view?.kind === "country"
      ? (stationsQuery.data?.error ?? null)
      : view?.kind === "search"
        ? (searchQuery.data?.error ?? null)
        : null;

  const panelCountry = useMemo(
    () =>
      panelCountryCode
        ? (countries.find((c) => c.code === panelCountryCode) ?? null)
        : null,
    [countries, panelCountryCode],
  );

  // ---------- globe ----------
  const globeCountries = useMemo(
    () => countries.filter((c) => COUNTRY_GEO[c.code]),
    [countries],
  );
  const globePlaces: GlobePlace[] = useMemo(
    () =>
      globeCountries.map((c) => {
        const geo = COUNTRY_GEO[c.code];
        return {
          label: displayName(c),
          lat: geo?.lat ?? 0,
          lng: geo?.lon ?? 0,
        };
      }),
    [globeCountries],
  );
  const globeSelectedIndex = useMemo(() => {
    if (view?.kind !== "country") return null;
    const idx = globeCountries.findIndex((c) => c.code === view.code);
    return idx >= 0 ? idx : null;
  }, [globeCountries, view]);

  const selectCountry = (code: string) => {
    setView({ kind: "country", code, genre: "" });
    document
      .getElementById("station-panel")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const selectFromGlobe = (index: number | null) => {
    if (index === null) return;
    const country = globeCountries[index];
    if (country) selectCountry(country.code);
  };

  // ---------- playback ----------
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const connectTimerRef = useRef<number | null>(null);
  const failedRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<Station[]>([]);
  const clickedRef = useRef<Set<string>>(new Set());

  const [current, setCurrent] = useState<Station | null>(null);
  const [status, setStatus] = useState<PlayStatus>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.9);
  const currentRef = useRef<Station | null>(null);
  currentRef.current = current;
  const statusRef = useRef<PlayStatus>("idle");
  statusRef.current = status;

  const clearConnectTimer = () => {
    if (connectTimerRef.current !== null) {
      window.clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  };

  // Radio Browser asks apps to register a click when a station starts
  // playing — it is how their charts stay honest. Best effort only.
  const registerClick = (station: Station) => {
    if (clickedRef.current.has(station.uuid)) return;
    clickedRef.current.add(station.uuid);
    void fetch(
      `https://de1.api.radio-browser.info/json/url/${station.uuid}`,
      { method: "POST" },
    ).catch(() => undefined);
  };

  const failCurrent = (reason: string) => {
    const station = currentRef.current;
    if (station) failedRef.current.add(station.uuid);
    const queue = queueRef.current;
    const idx = station
      ? queue.findIndex((s) => s.uuid === station.uuid)
      : -1;
    const next = queue
      .slice(idx + 1)
      .find((s) => !failedRef.current.has(s.uuid));
    if (station && next) {
      setNotice(
        `“${station.name}” ${reason} — trying ${next.name} instead.`,
      );
      startStation(next, queue);
    } else {
      clearConnectTimer();
      setStatus("error");
      setNotice(
        station
          ? `“${station.name}” ${reason}, and there's nothing left to try in this list. Pick another station.`
          : "That stream would not play. Pick another station.",
      );
    }
  };
  const failRef = useRef(failCurrent);
  failRef.current = failCurrent;

  const startStation = (station: Station, queue: Station[]) => {
    const audio = audioRef.current;
    if (!audio) return;
    queueRef.current = queue;
    setCurrent(station);
    setNotice(null);
    setStatus("connecting");
    audio.src = station.stream_url;
    audio.volume = volume;
    clearConnectTimer();
    connectTimerRef.current = window.setTimeout(() => {
      if (statusRef.current === "connecting") {
        failRef.current("never started");
      }
    }, CONNECT_TIMEOUT_MS);
    void audio.play().catch(() => {
      // The error event (or the connect timeout) drives the failure
      // path; a rejected play() promise alone is not conclusive.
    });
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: station.name,
        artist: [station.state, station.country]
          .filter(Boolean)
          .join(", "),
        album: "World Radio Tuner",
      });
    }
  };
  const startRef = useRef(startStation);
  startRef.current = startStation;

  // Create the audio element once and wire its events.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    audioRef.current = audio;
    const onPlaying = () => {
      clearConnectTimer();
      setStatus("playing");
      const station = currentRef.current;
      if (station) registerClick(station);
    };
    const onPause = () => {
      if (statusRef.current === "playing") setStatus("paused");
    };
    const onError = () => {
      if (currentRef.current) failRef.current("would not play");
    };
    const onEnded = () => {
      if (currentRef.current) failRef.current("ended");
    };
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("ended", onEnded);
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    navigator.mediaSession.setActionHandler("previoustrack", () =>
      step(-1),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playFrom = (list: Station[], station: Station) => {
    if (current?.uuid === station.uuid) {
      togglePlay();
      return;
    }
    failedRef.current = new Set();
    startStation(station, list);
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (status === "playing" || status === "connecting") {
      audio.pause();
      clearConnectTimer();
      setStatus("paused");
    } else {
      setStatus("connecting");
      clearConnectTimer();
      connectTimerRef.current = window.setTimeout(() => {
        if (statusRef.current === "connecting") {
          failRef.current("never started");
        }
      }, CONNECT_TIMEOUT_MS);
      void audio.play().catch(() => undefined);
    }
  };

  const step = (dir: 1 | -1) => {
    const queue = queueRef.current;
    if (!current || queue.length === 0) return;
    const idx = queue.findIndex((s) => s.uuid === current.uuid);
    if (idx < 0) return;
    for (let n = 1; n <= queue.length; n++) {
      const candidate =
        queue[(idx + dir * n + queue.length * n) % queue.length];
      if (candidate && !failedRef.current.has(candidate.uuid)) {
        startStation(candidate, queue);
        return;
      }
    }
  };

  const shufflePanel = () => {
    const playable = panelStations.filter(
      (s) => !failedRef.current.has(s.uuid),
    );
    if (playable.length === 0) return;
    const pick =
      playable[Math.floor(Math.random() * playable.length)] ??
      playable[0];
    if (pick) startStation(pick, panelStations);
  };

  // ---------- favorites ----------
  const favoriteMut = useMutation({
    mutationFn: (args: { station: Station; favorite: boolean }) =>
      api.toggleStationFavorite({
        favorite: args.favorite,
        station: stationSnapshot(args.station),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["favorites"] }),
  });

  const refreshMut = useMutation({
    mutationFn: () => api.getCountries({ force: true }),
    onSuccess: (data) =>
      queryClient.setQueryData(["countries"], data),
  });

  const submitStationSearch = () => {
    const q = stationSearch.trim();
    if (q.length < 2) return;
    setView({ kind: "search", query: q });
    document
      .getElementById("station-panel")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) =>
        displayName(c).toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase() === q,
    );
  }, [countries, countrySearch]);

  const fetchedAt = countriesQuery.data?.fetched_at ?? null;
  const countriesError = countriesQuery.data?.error ?? null;

  const renderStationRow = (station: Station, list: Station[]) => {
    const isCurrent = current?.uuid === station.uuid;
    const isFav = favoriteUuids.has(station.uuid);
    const busy = isCurrent && status === "connecting";
    return (
      <li
        key={station.uuid}
        className={isCurrent ? "map-selected bg-[var(--surface-alt)]" : ""}
      >
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => playFrom(list, station)}
            aria-label={
              isCurrent && status === "playing"
                ? `Pause ${station.name}`
                : `Play ${station.name}`
            }
            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
          >
            <span
              aria-hidden
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm ${
                isCurrent
                  ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border border-[var(--border)] text-[var(--accent)]"
              }`}
            >
              {busy ? "…" : isCurrent && status === "playing" ? "❚❚" : "▶"}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">
                {station.name}
              </span>
              <span className="block truncate text-xs text-[var(--dim)]">
                {[station.state, station.country]
                  .filter(Boolean)
                  .join(", ") || station.country_code}
                {station.tags.length > 0 &&
                  ` · ${station.tags.join(" · ")}`}
              </span>
              <span className="mono block text-[11px] text-[var(--dim)]">
                {station.codec}
                {station.bitrate > 0 ? ` ${station.bitrate} kbps` : ""} ·{" "}
                {station.https ? "https" : "http"} · ★ {station.votes}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              favoriteMut.mutate({ station, favorite: !isFav })
            }
            aria-label={
              isFav
                ? `Remove ${station.name} from favorites`
                : `Save ${station.name} to favorites`
            }
            aria-pressed={isFav}
            className={`px-3 text-lg ${
              isFav ? "text-[var(--accent)]" : "text-[var(--dim)]"
            }`}
          >
            {isFav ? "★" : "☆"}
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main className="mx-auto w-full max-w-5xl px-4 pb-44">
        {/* Status strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-5 pb-3">
          <p className="text-sm">
            {countriesQuery.isPending ? (
              "Loading the world of radio…"
            ) : countries.length > 0 ? (
              <>
                <span className="font-semibold text-[var(--accent)]">
                  {fmtCount(totalStations)}
                </span>{" "}
                live stations in{" "}
                <span className="font-semibold text-[var(--accent)]">
                  {countries.length}
                </span>{" "}
                countries — spin the earth, tap a country, press play.
              </>
            ) : (
              "The station directory could not be loaded"
            )}
          </p>
          <button
            type="button"
            onClick={() => refreshMut.mutate()}
            disabled={refreshMut.isPending}
            className="mono ml-auto rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {refreshMut.isPending ? "Refreshing…" : "↻ Refresh directory"}
          </button>
        </div>

        {countriesError && countries.length > 0 && (
          <p className="mb-3 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--dim)]">
            Last refresh failed ({countriesError}) — showing the directory
            as of{" "}
            {fetchedAt
              ? new Date(fetchedAt).toLocaleString()
              : "an earlier fetch"}
            .
          </p>
        )}

        {countriesQuery.isSuccess && countries.length === 0 && (
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center">
            <p className="text-base font-medium">
              The station directory did not answer
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-[var(--dim)]">
              The Radio Browser directory is run by volunteers
              {countriesError ? ` (${countriesError})` : ""}. Give it a
              moment and try again.
            </p>
            <button
              type="button"
              onClick={() => refreshMut.mutate()}
              className="mono mt-4 rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)]"
            >
              Try again
            </button>
          </div>
        )}

        {countries.length > 0 && (
          <>
            {/* Globe */}
            {globeAvailable ? (
              <>
                <GlobeMap
                  places={globePlaces}
                  selectedIndex={globeSelectedIndex}
                  onSelect={selectFromGlobe}
                  onUnavailable={() => setGlobeAvailable(false)}
                />
                <p className="mt-2 text-center text-xs text-[var(--dim)]">
                  Drag to spin the earth · scroll or pinch to zoom · tap a
                  country dot to hear it
                </p>
              </>
            ) : (
              <p className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--dim)]">
                The globe could not render on this device — every country
                is in the list below, and the music plays the same.
              </p>
            )}

            {/* Station search */}
            <form
              className="mt-5 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submitStationSearch();
              }}
            >
              <input
                type="search"
                value={stationSearch}
                onChange={(e) => setStationSearch(e.target.value)}
                placeholder="Search stations worldwide — try “samba”, “jazz”, a station name…"
                aria-label="Search stations by name"
                className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
              />
              <button
                type="submit"
                className="mono rounded bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-ink)]"
              >
                Search
              </button>
            </form>

            {/* Station panel */}
            <section
              id="station-panel"
              aria-label="Stations"
              className="mt-5 scroll-mt-4"
            >
              {view === null ? (
                <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] px-4 py-8 text-center">
                  <p className="font-medium">Pick a country to start listening</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-[var(--dim)]">
                    Tap a dot on the globe, choose from the country list
                    below, or search for a station. Music plays right here —
                    no new tabs.
                  </p>
                </div>
              ) : (
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] px-4 py-3">
                    <h2 className="text-lg font-semibold">
                      {view.kind === "country"
                        ? panelCountry
                          ? displayName(panelCountry)
                          : view.code
                        : `Results for “${view.kind === "search" ? view.query : ""}”`}
                    </h2>
                    {view.kind === "country" && panelCountry && (
                      <p className="mono text-xs text-[var(--dim)]">
                        {fmtCount(panelCountry.station_count)} stations in
                        the directory
                      </p>
                    )}
                    <div className="ml-auto flex gap-2">
                      <button
                        type="button"
                        onClick={shufflePanel}
                        disabled={panelStations.length === 0}
                        className="mono rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-ink)] disabled:opacity-40"
                      >
                        ⤨ Surprise me
                      </button>
                      <button
                        type="button"
                        onClick={() => setView(null)}
                        aria-label="Close station panel"
                        className="mono rounded border border-[var(--border)] px-3 py-1.5 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {view.kind === "country" && (
                    <div
                      className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-4 py-3"
                      role="group"
                      aria-label="Filter by genre"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setView({ kind: "country", code: view.code, genre: "" })
                        }
                        aria-pressed={view.genre === ""}
                        className={`mono rounded-full px-3 py-1 text-xs ${
                          view.genre === ""
                            ? "bg-[var(--accent)] font-semibold text-[var(--accent-ink)]"
                            : "border border-[var(--border)]"
                        }`}
                      >
                        All music
                      </button>
                      {GENRES.map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() =>
                            setView({ kind: "country", code: view.code, genre: g })
                          }
                          aria-pressed={view.genre === g}
                          className={`mono rounded-full px-3 py-1 text-xs capitalize ${
                            view.genre === g
                              ? "bg-[var(--accent)] font-semibold text-[var(--accent-ink)]"
                              : "border border-[var(--border)]"
                          }`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  )}

                  {panelLoading ? (
                    <p className="px-4 py-8 text-center text-sm text-[var(--dim)]">
                      Tuning the directory…
                    </p>
                  ) : panelError ? (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm">
                        The station list did not load ({panelError}).
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          view.kind === "country"
                            ? stationsQuery.refetch()
                            : searchQuery.refetch()
                        }
                        className="mono mt-3 rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)]"
                      >
                        Try again
                      </button>
                    </div>
                  ) : panelStations.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-[var(--dim)]">
                      {view.kind === "country" && view.genre
                        ? `No playable ${view.genre} stations turned up here — try “All music” or another genre.`
                        : "No playable stations turned up. Try another pick."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-[var(--border)]">
                      {panelStations.map((s) =>
                        renderStationRow(s, panelStations),
                      )}
                    </ul>
                  )}
                </div>
              )}
            </section>

            {/* Favorites */}
            {favorites.length > 0 && (
              <section aria-label="Favorite stations" className="mt-8">
                <h2 className="text-lg font-semibold">Your favorites</h2>
                <ul className="mt-3 divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
                  {favorites.map((s) => renderStationRow(s, favorites))}
                </ul>
              </section>
            )}

            {/* Country browser */}
            <section aria-label="Browse countries" className="mt-8">
              <h2 className="text-lg font-semibold">Every country</h2>
              <input
                type="search"
                value={countrySearch}
                onChange={(e) => setCountrySearch(e.target.value)}
                placeholder="Find a country…"
                aria-label="Find a country"
                className="mt-3 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
              />
              <p className="mono mt-3 text-xs text-[var(--dim)]">
                Showing {Math.min(filteredCountries.length, 80)} of{" "}
                {filteredCountries.length} countries
                {filteredCountries.length > 80
                  ? " — keep typing to narrow it down"
                  : ""}
              </p>
              <ul className="mt-2 divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
                {filteredCountries.slice(0, 80).map((c) => {
                  const isSelected =
                    view?.kind === "country" && view.code === c.code;
                  return (
                    <li key={c.code} className={isSelected ? "map-selected bg-[var(--surface-alt)]" : ""}>
                      <button
                        type="button"
                        onClick={() => selectCountry(c.code)}
                        aria-label={`Hear stations from ${displayName(c)}`}
                        className="flex w-full items-baseline gap-3 px-4 py-2.5 text-left"
                      >
                        <span className="font-medium">
                          {displayName(c)}
                        </span>
                        <span className="mono ml-auto text-xs text-[var(--dim)]">
                          {fmtCount(c.station_count)} stations
                        </span>
                      </button>
                    </li>
                  );
                })}
                {filteredCountries.length === 0 && (
                  <li className="px-4 py-6 text-center text-sm text-[var(--dim)]">
                    No country matches that spelling — try the English
                    name.
                  </li>
                )}
              </ul>
            </section>
          </>
        )}

        <footer className="mt-10 border-t border-[var(--border)] pt-4 text-xs text-[var(--dim)]">
          <p>
            Station directory:{" "}
            <a
              href="https://www.radio-browser.info/"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              Radio Browser
            </a>
            , the free community-run index of internet radio. Audio
            streams directly from each station's own server to your
            browser — stations marked “https” are listed first because
            secure pages can't play plain-http audio. A station that
            won't start is skipped automatically; if one sounds wrong,
            it's the station, not you.
          </p>
        </footer>
      </main>

      {/* Player bar */}
      {current && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--border)] bg-[var(--surface)] shadow-[0_-4px_24px_rgba(0,0,0,0.25)]">
          <div
            className="mx-auto w-full max-w-5xl px-4 pt-3"
            style={{
              paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
            }}
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous station"
                className="mono flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-sm"
              >
                ⏮
              </button>
              <button
                type="button"
                onClick={togglePlay}
                aria-label={
                  status === "playing" || status === "connecting"
                    ? `Pause ${current.name}`
                    : `Play ${current.name}`
                }
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-lg text-[var(--accent-ink)]"
              >
                {status === "connecting"
                  ? "…"
                  : status === "playing"
                    ? "❚❚"
                    : "▶"}
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next station"
                className="mono flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-sm"
              >
                ⏭
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{current.name}</p>
                <p className="truncate text-xs text-[var(--dim)]">
                  {[current.state, current.country]
                    .filter(Boolean)
                    .join(", ")}
                  {" · "}
                  <span className="mono">
                    {status === "connecting"
                      ? "connecting…"
                      : status === "playing"
                        ? "live"
                        : status === "paused"
                          ? "paused"
                          : status === "error"
                            ? "stream failed"
                            : ""}
                  </span>
                  {current.homepage && (
                    <>
                      {" · "}
                      <a
                        href={current.homepage}
                        target="_blank"
                        rel="noopener"
                        className="underline"
                      >
                        station site
                      </a>
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  favoriteMut.mutate({
                    station: current,
                    favorite: !favoriteUuids.has(current.uuid),
                  })
                }
                aria-label={
                  favoriteUuids.has(current.uuid)
                    ? `Remove ${current.name} from favorites`
                    : `Save ${current.name} to favorites`
                }
                aria-pressed={favoriteUuids.has(current.uuid)}
                className={`shrink-0 px-1 text-xl ${
                  favoriteUuids.has(current.uuid)
                    ? "text-[var(--accent)]"
                    : "text-[var(--dim)]"
                }`}
              >
                {favoriteUuids.has(current.uuid) ? "★" : "☆"}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <label
                htmlFor="volume"
                className="mono text-[11px] text-[var(--dim)]"
              >
                VOL
              </label>
              <input
                id="volume"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume"
                className="w-36 accent-[var(--accent)]"
              />
              {notice && (
                <p className="min-w-0 flex-1 truncate text-xs text-[var(--dim)]">
                  {notice}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
