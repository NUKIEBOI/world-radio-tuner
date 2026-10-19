# World Radio Tuner

**A DXer's command center for shortwave radio.** Tune public KiwiSDR receivers
around the world, jump to famous stations with one click, and log your catches
in a UTC logbook — no radio hardware required.

This is a full-stack TypeScript app (React + Drizzle + SQLite). The live app
runs on the hosted artifact runtime; this repo holds the complete source.

## What it does

- **Live receiver directory** — pulls the real public KiwiSDR listing
  (~886 receivers worldwide at last fetch), plotted on a world map and sorted
  by distance from your location, with search, region, free-slot, and
  favorites filters. Auto-refreshes when the snapshot goes stale.
- **Tuning console** — pick a receiver, dial any frequency + mode, and open it
  in a new tab already tuned via the KiwiSDR `?f=<kHz><mode>` deep link.
- **Preset deck** — one-click tuning for the classics: The Buzzer (4625 kHz),
  The Pip, The Squeaky Wheel, HFGCS, Shannon/RAF VOLMET, North Atlantic ATC,
  WWV, CHU, the 20m/40m ham bands, and the 49m broadcast band. "Tune it" picks
  the least-loaded receiver in the signal's home region.
- **Logbook** — record catches (station, frequency, receiver, UTC time, signal
  rating, notes) with full edit/delete. Starts empty, ready for your first catch.

Everything is receive-only: listening to signals broadcast in the clear on
receivers their owners share publicly.

## Project layout

| Path | What it is |
|---|---|
| `client/src/` | React frontend (tuner console, map, presets, logbook) |
| `client/src/presets.ts` | The preset station library |
| `server/src/actions.ts` | Server actions (receiver directory refresh, logbook CRUD) |
| `server/src/schema.ts` | Drizzle schema |
| `drizzle/` | SQL migrations |

## Run it locally

```bash
bun install
bun run dev
```

(Built with the Muse web-artifact runtime; `space.json` describes the deployment.)
