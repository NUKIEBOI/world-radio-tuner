import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";
import { PRESETS, type Preset, type Region } from "./presets";
import { ReceiverMap, type MapPlace } from "./ReceiverMap";

type State = ApiResponse<typeof api, "getState">;
type Receiver = State["receivers"][number];
type LogEntry = State["log"][number];

// Reference point for "nearest" — Burlington, NC.
const HOME = { lat: 36.0957, lon: -79.4378 };
const MODES = ["USB", "LSB", "AM", "CW"] as const;
const REGIONS: Region[] = [
  "North America",
  "South America",
  "Europe",
  "Africa",
  "Asia",
  "Oceania",
];
const STALE_MS = 6 * 60 * 60 * 1000;

function regionOf(lat: number, lon: number): Region {
  if (lat < -10 && lon > 110) return "Oceania";
  if (lat < 0 && lon < -110) return "Oceania";
  if (lon >= -170 && lon <= -30) {
    if (lat >= 13) return "North America";
    return lon <= -77.5 ? "North America" : "South America";
  }
  if (lon > -25 && lon < 40 && lat >= 35) return "Europe";
  if (lon >= -20 && lon < 52 && lat < 36 && lat >= -36) return "Africa";
  if (lon >= 110 && lat < 5 && lat >= -12) return "Oceania";
  return "Asia";
}

function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

function isFull(r: Receiver): boolean {
  return r.users !== null && r.users_max !== null && r.users >= r.users_max;
}

function hasFreeSlot(r: Receiver): boolean {
  return !isFull(r);
}

// KiwiSDR deep link: opens the receiver already tuned (documented
// ?f=<kHz><mode> URL parameter). WebSDRs don't share that scheme, so
// they just open at their home page.
function tuneUrl(r: Receiver, freqKhz: number, mode: string): string {
  if (r.type !== "KiwiSDR") return r.url;
  const base = r.url.endsWith("/") ? r.url.slice(0, -1) : r.url;
  return `${base}/?f=${freqKhz}${mode.toLowerCase()}`;
}

function fmtKhz(khz: number): string {
  return khz.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtMiles(mi: number): string {
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi).toLocaleString("en-US")} mi`;
}

function fmtUtc(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface LogForm {
  station: string;
  freq: string;
  mode: string;
  receiverName: string;
  listenedAt: string;
  notes: string;
  rating: string;
}

const emptyLogForm = (): LogForm => ({
  station: "",
  freq: "",
  mode: "USB",
  receiverName: "",
  listenedAt: toLocalInputValue(new Date()),
  notes: "",
  rating: "",
});

export function App() {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: ["state"],
    queryFn: () => api.getState({}),
  });
  const data = state.data;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [freqStr, setFreqStr] = useState("4625");
  const [mode, setMode] = useState<string>("USB");
  const [activePresetId, setActivePresetId] = useState<string | null>("buzzer");
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState<string>("All");
  const [sortKey, setSortKey] = useState<"distance" | "listeners" | "name">(
    "distance",
  );
  const [availableOnly, setAvailableOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [mapAvailable, setMapAvailable] = useState(true);
  const [logForm, setLogForm] = useState<LogForm>(emptyLogForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const refreshMut = useMutation({
    mutationFn: () => api.refreshReceivers({}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
  });
  const favoriteMut = useMutation({
    mutationFn: (args: { receiverId: string; favorite: boolean }) =>
      api.toggleFavorite(args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
  });
  const addLogMut = useMutation({
    mutationFn: (args: Parameters<typeof api.addLogEntry>[0]) =>
      api.addLogEntry(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      setLogForm(emptyLogForm());
      setEditingId(null);
      setLogError(null);
    },
    onError: (e) => setLogError(String(e)),
  });
  const updateLogMut = useMutation({
    mutationFn: (args: Parameters<typeof api.updateLogEntry>[0]) =>
      api.updateLogEntry(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      setLogForm(emptyLogForm());
      setEditingId(null);
      setLogError(null);
    },
    onError: (e) => setLogError(String(e)),
  });
  const deleteLogMut = useMutation({
    mutationFn: (id: number) => api.deleteLogEntry({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
  });

  // Refresh the directory on open when the snapshot is missing or stale.
  const autoRefreshRef = useRef(false);
  useEffect(() => {
    if (!data || autoRefreshRef.current || refreshMut.isPending) return;
    const fetchedAt = data.meta.fetched_at;
    const stale =
      !fetchedAt || Date.now() - new Date(fetchedAt).getTime() > STALE_MS;
    if (stale) {
      autoRefreshRef.current = true;
      refreshMut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const receivers = useMemo(() => data?.receivers ?? [], [data]);
  const favorites = useMemo(
    () => new Set(data?.favorites ?? []),
    [data],
  );

  const withDistance = useMemo(
    () =>
      receivers.map((r) => ({
        receiver: r,
        distance: haversineMiles(HOME.lat, HOME.lon, r.lat, r.lon),
        region: regionOf(r.lat, r.lon),
      })),
    [receivers],
  );

  const selected = useMemo(
    () => receivers.find((r) => r.id === selectedId) ?? null,
    [receivers, selectedId],
  );

  // Default the console to the nearest receiver with a free slot.
  useEffect(() => {
    if (selectedId || withDistance.length === 0) return;
    const sorted = [...withDistance].sort(
      (a, b) => a.distance - b.distance,
    );
    const pick = sorted.find((x) => hasFreeSlot(x.receiver)) ?? sorted[0];
    if (pick) setSelectedId(pick.receiver.id);
  }, [withDistance, selectedId]);

  const mapPlaces: MapPlace[] = useMemo(
    () =>
      receivers.map((r) => ({ label: r.name, lat: r.lat, lng: r.lon })),
    [receivers],
  );
  const selectedMapIndex = useMemo(() => {
    if (!selectedId) return null;
    const idx = receivers.findIndex((r) => r.id === selectedId);
    return idx >= 0 ? idx : null;
  }, [receivers, selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = withDistance.filter(({ receiver: r, region }) => {
      if (regionFilter !== "All" && region !== regionFilter) return false;
      if (availableOnly && !hasFreeSlot(r)) return false;
      if (favoritesOnly && !favorites.has(r.id)) return false;
      if (
        q &&
        !`${r.name} ${r.location} ${r.antenna}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sortKey === "distance") return a.distance - b.distance;
      if (sortKey === "name")
        return a.receiver.name.localeCompare(b.receiver.name);
      const score = (r: Receiver) =>
        (r.users ?? 0) + (isFull(r) ? 100000 : 0) + (r.users === null ? 500 : 0);
      return score(a.receiver) - score(b.receiver);
    });
    return rows;
  }, [withDistance, search, regionFilter, availableOnly, favoritesOnly, favorites, sortKey]);

  const regionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { region } of withDistance) {
      counts.set(region, (counts.get(region) ?? 0) + 1);
    }
    return counts;
  }, [withDistance]);

  const bestInRegion = (region: Region): Receiver | null => {
    const candidates = withDistance
      .filter((x) => x.region === region && hasFreeSlot(x.receiver))
      .sort((a, b) => {
        const load = (r: Receiver) =>
          (r.users ?? 0) / Math.max(r.users_max ?? 8, 1);
        return load(a.receiver) - load(b.receiver);
      });
    return candidates[0]?.receiver ?? null;
  };

  const applyPreset = (preset: Preset) => {
    setActivePresetId(preset.id);
    setFreqStr(String(preset.freqKhz));
    setMode(preset.mode);
  };

  const tunePreset = (preset: Preset) => {
    applyPreset(preset);
    const target = bestInRegion(preset.bestRegion) ?? selected;
    if (target) {
      setSelectedId(target.id);
      window.open(tuneUrl(target, preset.freqKhz, preset.mode), "_blank", "noopener");
    }
  };

  const selectFromMap = (index: number | null) => {
    if (index === null) return;
    const r = receivers[index];
    if (!r) return;
    setSelectedId(r.id);
    const el = rowRefs.current.get(r.id);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const freqKhz = Number.parseFloat(freqStr);
  const freqValid = Number.isFinite(freqKhz) && freqKhz > 0 && freqKhz <= 30000;

  const openTuner = () => {
    if (!selected || !freqValid) return;
    window.open(tuneUrl(selected, freqKhz, mode), "_blank", "noopener");
  };

  const prefillLogFromDial = () => {
    const preset = PRESETS.find((p) => p.id === activePresetId);
    setLogForm((f) => ({
      ...f,
      station: preset ? preset.name : f.station,
      freq: freqStr,
      mode,
      receiverName: selected?.location ?? selected?.name ?? f.receiverName,
      listenedAt: toLocalInputValue(new Date()),
    }));
    document
      .getElementById("logbook")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submitLog = () => {
    const freq = Number.parseFloat(logForm.freq);
    if (!logForm.station.trim()) {
      setLogError("Give the station or signal a name.");
      return;
    }
    if (!Number.isFinite(freq) || freq <= 0) {
      setLogError("Enter the frequency in kHz.");
      return;
    }
    const payload = {
      station: logForm.station.trim(),
      freqKhz: freq,
      mode: logForm.mode,
      receiverName: logForm.receiverName.trim(),
      listenedAt: new Date(logForm.listenedAt).toISOString(),
      notes: logForm.notes.trim(),
      rating: logForm.rating ? Number.parseInt(logForm.rating, 10) : null,
    };
    if (editingId !== null) {
      updateLogMut.mutate({ id: editingId, ...payload });
    } else {
      addLogMut.mutate(payload);
    }
  };

  const startEdit = (entry: LogEntry) => {
    setEditingId(entry.id);
    setLogError(null);
    setLogForm({
      station: entry.station,
      freq: String(entry.freq_khz),
      mode: entry.mode,
      receiverName: entry.receiver_name,
      listenedAt: toLocalInputValue(new Date(entry.listened_at)),
      notes: entry.notes,
      rating: entry.rating ? String(entry.rating) : "",
    });
    document
      .getElementById("logbook")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const fetchedAt = data?.meta.fetched_at ?? null;
  const lastError = data?.meta.last_error ?? null;
  const freeCount = receivers.filter(hasFreeSlot).length;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main className="mx-auto w-full max-w-5xl px-4 pb-16">
        {/* Status strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-5 pb-3">
          <p className="mono text-sm">
            {state.isPending ? (
              "Loading the directory…"
            ) : receivers.length > 0 ? (
              <>
                <span className="text-[var(--accent)] font-semibold">
                  {receivers.length}
                </span>{" "}
                public receivers · {freeCount} with a free slot
              </>
            ) : (
              "No receiver directory yet"
            )}
          </p>
          <p className="mono text-xs text-[var(--dim)]">
            {refreshMut.isPending
              ? "Refreshing from kiwisdr.com directory…"
              : fetchedAt
                ? `Directory updated ${fmtUtc(fetchedAt)}`
                : "Directory not fetched yet"}
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

        {lastError && receivers.length > 0 && (
          <p className="mb-3 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--dim)]">
            Last refresh failed ({lastError}) — showing the directory as of{" "}
            {fetchedAt ? fmtUtc(fetchedAt) : "an earlier fetch"}.
          </p>
        )}

        {/* Empty / error state before first successful fetch */}
        {state.isSuccess && receivers.length === 0 && (
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center">
            <p className="text-base font-medium">
              {refreshMut.isPending
                ? "Fetching the worldwide receiver directory…"
                : "The receiver directory could not be fetched"}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-[var(--dim)]">
              {refreshMut.isPending
                ? "Pulling ~900 public KiwiSDR and WebSDR receivers from the kiwisdr.com directory."
                : `The directory feed did not answer${lastError ? ` (${lastError})` : ""}. It is a volunteer-run mirror, so give it a moment and try again.`}
            </p>
            {!refreshMut.isPending && (
              <button
                type="button"
                onClick={() => refreshMut.mutate()}
                className="mono mt-4 rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)]"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {receivers.length > 0 && (
          <>
            {/* Map */}
            {mapAvailable ? (
              <ReceiverMap
                places={mapPlaces}
                selectedIndex={selectedMapIndex}
                onSelect={selectFromMap}
                onUnavailable={() => setMapAvailable(false)}
              />
            ) : (
              <p className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--dim)]">
                Map unavailable on this device — the receiver list below has
                everything the map does.
              </p>
            )}

            {/* Tuning console */}
            <section
              aria-label="Tuning console"
              className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
            >
              <div className="border-b border-[var(--border)] px-4 py-3">
                <p className="text-xs tracking-wide text-[var(--dim)] uppercase">
                  Now selected
                </p>
                {selected ? (
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="font-medium">{selected.location || selected.name}</p>
                    <p className="mono text-xs text-[var(--dim)]">
                      {selected.type} · {selected.lat.toFixed(2)},{" "}
                      {selected.lon.toFixed(2)} ·{" "}
                      {fmtMiles(
                        haversineMiles(HOME.lat, HOME.lon, selected.lat, selected.lon),
                      )}{" "}
                      from Burlington, NC
                    </p>
                    <p className="mono text-xs">
                      {selected.users !== null && selected.users_max !== null ? (
                        <span className={isFull(selected) ? "text-[var(--full)]" : "text-[var(--signal)]"}>
                          {selected.users}/{selected.users_max} listening
                          {isFull(selected) ? " — full" : ""}
                        </span>
                      ) : (
                        <span className="text-[var(--dim)]">listener count not published</span>
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-[var(--dim)]">
                    Pick a receiver on the map or in the list.
                  </p>
                )}
                {selected?.antenna && (
                  <p className="mt-1 truncate text-xs text-[var(--dim)]">
                    Antenna: {selected.antenna}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-3 px-4 py-4">
                <div>
                  <label
                    htmlFor="freq-input"
                    className="text-xs tracking-wide text-[var(--dim)] uppercase"
                  >
                    Frequency (kHz)
                  </label>
                  <input
                    id="freq-input"
                    inputMode="decimal"
                    value={freqStr}
                    onChange={(e) => {
                      setFreqStr(e.target.value);
                      setActivePresetId(null);
                    }}
                    className="mono mt-1 block w-44 rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-3xl font-semibold text-[var(--accent)]"
                    aria-describedby="freq-hint"
                  />
                  <p id="freq-hint" className="mono mt-1 text-xs text-[var(--dim)]">
                    {freqValid
                      ? `= ${(freqKhz / 1000).toFixed(4)} MHz`
                      : "Enter 100 – 30000 kHz"}
                  </p>
                </div>
                <div>
                  <label
                    htmlFor="mode-select"
                    className="text-xs tracking-wide text-[var(--dim)] uppercase"
                  >
                    Mode
                  </label>
                  <select
                    id="mode-select"
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                    className="mono mt-1 block rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-lg"
                  >
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={openTuner}
                  disabled={!selected || !freqValid}
                  className="mono rounded bg-[var(--accent)] px-5 py-3 text-base font-bold text-[var(--accent-ink)] disabled:opacity-40"
                >
                  ▶ Open tuner
                </button>
                <button
                  type="button"
                  onClick={prefillLogFromDial}
                  className="mono rounded border border-[var(--border)] px-4 py-3 text-sm"
                >
                  Log this catch
                </button>
              </div>
              <p className="border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--dim)]">
                The tuner opens in a new tab, already set to your frequency —
                the receiver owner's page plays the audio and shows the
                waterfall. Receivers are shared: popular ones fill up.
              </p>
            </section>

            {/* Preset deck */}
            <section aria-label="Listening presets" className="mt-8">
              <h2 className="text-lg font-semibold">Preset deck</h2>
              <p className="mt-1 text-sm text-[var(--dim)]">
                The good stuff, one tap away. “Tune it” picks the
                least-loaded receiver in the region where the signal
                originates and opens it on frequency.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {PRESETS.map((preset) => (
                  <article
                    key={preset.id}
                    className={`flex flex-col rounded-[var(--radius)] border bg-[var(--surface)] p-4 ${
                      activePresetId === preset.id
                        ? "border-[var(--accent)]"
                        : "border-[var(--border)]"
                    }`}
                  >
                    <p className="text-xs tracking-wide text-[var(--dim)] uppercase">
                      {preset.category}
                    </p>
                    <h3 className="mt-1 font-medium">{preset.name}</h3>
                    <p className="mono mt-1 text-2xl font-semibold text-[var(--accent)]">
                      {fmtKhz(preset.freqKhz)}
                      <span className="ml-1 text-sm font-normal text-[var(--dim)]">
                        kHz {preset.mode}
                      </span>
                    </p>
                    <p className="mt-2 flex-1 text-sm text-[var(--dim)]">
                      {preset.blurb}
                    </p>
                    <p className="mono mt-2 text-xs text-[var(--dim)]">
                      Best from {preset.bestRegion} (
                      {regionCounts.get(preset.bestRegion) ?? 0} receivers) ·{" "}
                      {preset.bestTime}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => tunePreset(preset)}
                        className="mono flex-1 rounded bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-ink)]"
                        aria-label={`Tune ${preset.name} on a receiver in ${preset.bestRegion}`}
                      >
                        Tune it
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className="mono rounded border border-[var(--border)] px-3 py-2 text-sm"
                        aria-label={`Load ${preset.name} into the dial`}
                      >
                        Load dial
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {/* Directory */}
            <section aria-label="Receiver directory" className="mt-8">
              <h2 className="text-lg font-semibold">Receiver directory</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search place, name, antenna…"
                  aria-label="Search receivers"
                  className="min-w-44 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                />
                <select
                  value={regionFilter}
                  onChange={(e) => setRegionFilter(e.target.value)}
                  aria-label="Filter by region"
                  className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                >
                  <option value="All">All regions</option>
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r} ({regionCounts.get(r) ?? 0})
                    </option>
                  ))}
                </select>
                <select
                  value={sortKey}
                  onChange={(e) =>
                    setSortKey(e.target.value as typeof sortKey)
                  }
                  aria-label="Sort receivers"
                  className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                >
                  <option value="distance">Nearest first</option>
                  <option value="listeners">Fewest listeners</option>
                  <option value="name">Name A–Z</option>
                </select>
                <label className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={availableOnly}
                    onChange={(e) => setAvailableOnly(e.target.checked)}
                  />
                  Free slot only
                </label>
                <label className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={favoritesOnly}
                    onChange={(e) => setFavoritesOnly(e.target.checked)}
                  />
                  ★ Favorites
                </label>
              </div>

              <p className="mono mt-3 text-xs text-[var(--dim)]">
                Showing {Math.min(filtered.length, 60)} of {filtered.length}{" "}
                matching receivers
                {filtered.length > 60 ? " — narrow the search to see more" : ""}
              </p>
              <ul className="mt-2 divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
                {filtered.slice(0, 60).map(({ receiver: r, distance, region }) => {
                  const isSelected = r.id === selectedId;
                  const isFav = favorites.has(r.id);
                  return (
                    <li
                      key={r.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(r.id, el);
                        else rowRefs.current.delete(r.id);
                      }}
                      className={isSelected ? "map-selected bg-[var(--surface-alt)]" : ""}
                    >
                      <div className="flex items-stretch">
                        <button
                          type="button"
                          onClick={() => setSelectedId(r.id)}
                          className="min-w-0 flex-1 px-4 py-3 text-left"
                          aria-label={`Select receiver ${r.location || r.name}`}
                        >
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-medium">
                              {r.location || r.name}
                            </span>
                            <span className="mono text-xs text-[var(--dim)]">
                              {r.type} · {region}
                            </span>
                          </span>
                          <span className="mono mt-0.5 block text-xs text-[var(--dim)]">
                            {fmtMiles(distance)} · {r.lat.toFixed(2)},{" "}
                            {r.lon.toFixed(2)}
                            {r.users !== null && r.users_max !== null && (
                              <>
                                {" · "}
                                <span
                                  className={
                                    isFull(r)
                                      ? "text-[var(--full)]"
                                      : "text-[var(--signal)]"
                                  }
                                >
                                  {r.users}/{r.users_max} listening
                                  {isFull(r) ? " (full)" : ""}
                                </span>
                              </>
                            )}
                          </span>
                          {r.antenna && (
                            <span className="mt-0.5 block truncate text-xs text-[var(--dim)]">
                              {r.antenna}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            favoriteMut.mutate({
                              receiverId: r.id,
                              favorite: !isFav,
                            })
                          }
                          aria-label={
                            isFav
                              ? `Remove ${r.location || r.name} from favorites`
                              : `Star ${r.location || r.name} as a favorite`
                          }
                          aria-pressed={isFav}
                          className={`px-4 text-xl ${
                            isFav ? "text-[var(--accent)]" : "text-[var(--dim)]"
                          }`}
                        >
                          {isFav ? "★" : "☆"}
                        </button>
                      </div>
                    </li>
                  );
                })}
                {filtered.length === 0 && (
                  <li className="px-4 py-8 text-center text-sm text-[var(--dim)]">
                    No receivers match those filters. Loosen the search or
                    untick “Free slot only”.
                  </li>
                )}
              </ul>
            </section>
          </>
        )}

        {/* Logbook */}
        <section
          id="logbook"
          aria-label="Listening logbook"
          className="mt-10 scroll-mt-4"
        >
          <h2 className="text-lg font-semibold">Logbook</h2>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Record what you catch — station, frequency, receiver, and what
            you heard. Times are kept in UTC, the way shortwave listeners
            log.
          </p>

          <form
            className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitLog();
            }}
          >
            <p className="text-sm font-medium">
              {editingId !== null ? "Edit log entry" : "Add a catch"}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="log-station" className="text-xs text-[var(--dim)]">
                  Station / signal
                </label>
                <input
                  id="log-station"
                  value={logForm.station}
                  onChange={(e) =>
                    setLogForm((f) => ({ ...f, station: e.target.value }))
                  }
                  placeholder="e.g. The Buzzer — UVB-76"
                  className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="log-freq" className="text-xs text-[var(--dim)]">
                    Frequency (kHz)
                  </label>
                  <input
                    id="log-freq"
                    inputMode="decimal"
                    value={logForm.freq}
                    onChange={(e) =>
                      setLogForm((f) => ({ ...f, freq: e.target.value }))
                    }
                    placeholder="4625"
                    className="mono mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="log-mode" className="text-xs text-[var(--dim)]">
                    Mode
                  </label>
                  <select
                    id="log-mode"
                    value={logForm.mode}
                    onChange={(e) =>
                      setLogForm((f) => ({ ...f, mode: e.target.value }))
                    }
                    className="mono mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
                  >
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="log-receiver" className="text-xs text-[var(--dim)]">
                  Receiver used
                </label>
                <input
                  id="log-receiver"
                  value={logForm.receiverName}
                  onChange={(e) =>
                    setLogForm((f) => ({ ...f, receiverName: e.target.value }))
                  }
                  placeholder="e.g. Raleigh, NC"
                  className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="log-when" className="text-xs text-[var(--dim)]">
                    When (your local time)
                  </label>
                  <input
                    id="log-when"
                    type="datetime-local"
                    value={logForm.listenedAt}
                    onChange={(e) =>
                      setLogForm((f) => ({ ...f, listenedAt: e.target.value }))
                    }
                    className="mono mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="log-rating" className="text-xs text-[var(--dim)]">
                    Signal rating
                  </label>
                  <select
                    id="log-rating"
                    value={logForm.rating}
                    onChange={(e) =>
                      setLogForm((f) => ({ ...f, rating: e.target.value }))
                    }
                    className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
                  >
                    <option value="">Not rated</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {"★".repeat(n)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="log-notes" className="text-xs text-[var(--dim)]">
                  Notes — what did you hear?
                </label>
                <textarea
                  id="log-notes"
                  value={logForm.notes}
                  onChange={(e) =>
                    setLogForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  rows={3}
                  placeholder="Voice message at the top of the hour, callsign + number groups…"
                  className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
                />
              </div>
            </div>
            {logError && (
              <p className="mt-2 text-sm text-[var(--full)]">{logError}</p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="submit"
                disabled={addLogMut.isPending || updateLogMut.isPending}
                className="mono rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] disabled:opacity-50"
              >
                {editingId !== null ? "Save changes" : "Add to logbook"}
              </button>
              {editingId !== null && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setLogForm(emptyLogForm());
                    setLogError(null);
                  }}
                  className="mono rounded border border-[var(--border)] px-4 py-2 text-sm"
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>

          {data && data.log.length > 0 ? (
            <ul className="mt-3 divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
              {data.log.map((entry) => (
                <li key={entry.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="font-medium">{entry.station}</p>
                    <p className="mono text-sm text-[var(--accent)]">
                      {fmtKhz(entry.freq_khz)} kHz {entry.mode}
                    </p>
                    {entry.rating !== null && (
                      <p className="text-sm text-[var(--accent)]" aria-label={`Rated ${entry.rating} of 5`}>
                        {"★".repeat(entry.rating)}
                      </p>
                    )}
                  </div>
                  <p className="mono mt-0.5 text-xs text-[var(--dim)]">
                    {fmtUtc(entry.listened_at)}
                    {entry.receiver_name ? ` · via ${entry.receiver_name}` : ""}
                  </p>
                  {entry.notes && (
                    <p className="mt-1 text-sm">{entry.notes}</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(entry)}
                      className="mono rounded border border-[var(--border)] px-3 py-1 text-xs"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteLogMut.mutate(entry.id)}
                      className="mono rounded border border-[var(--border)] px-3 py-1 text-xs text-[var(--full)]"
                      aria-label={`Delete log entry for ${entry.station}`}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--dim)]">
              Nothing logged yet. Tune into something interesting, then hit
              “Log this catch” in the console.
            </p>
          )}
        </section>

        <footer className="mt-10 border-t border-[var(--border)] pt-4 text-xs text-[var(--dim)]">
          <p>
            Receiver directory: the public KiwiSDR list (kiwisdr.com),
            mirrored by{" "}
            <a
              href="http://rx.linkfanel.net/"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              rx.linkfanel.net
            </a>
            , plus its curated WebSDRs. Every receiver here is a radio
            someone chose to share publicly, and everything these presets
            point at is broadcast in the clear — receiving it is legal;
            encrypted traffic stays encrypted and isn't part of this.
          </p>
        </footer>
      </main>
    </div>
  );
}
