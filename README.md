# World Radio Tuner

**Spin the earth, hear the planet.** A Radio Garden–style globe of live
internet radio: drag the world around, tap a country, and listen to its
music stations right in the page.

This is the **standalone edition** — clone it and run it anywhere with
[Bun](https://bun.sh). (There's also a hosted live version; this repo is
the runnable source.)

## Run it

1. Install Bun: https://bun.sh
2. Then:

```bash
git clone https://github.com/NUKIEBOI/world-radio-tuner.git
cd world-radio-tuner
bun install
bun run dev
```

Open http://localhost:3000 — that's it. Your favorites and directory
cache live in `tuner.db` (SQLite, created automatically).

## What it does

- **Spinning globe** — dark, Radio Garden-style earth. Drag to spin it,
  tap a country's glowing dot to open its stations.
- **Live station directory** — data from [Radio Browser](https://www.radio-browser.info/),
  the free community-run index of internet radio (~55,000 working stations
  across 242 countries). Top stations per country by community votes,
  filterable by genre, plus worldwide search and a "Surprise me" shuffle.
- **In-page player** — streams play straight from each station's own
  server to your browser. HTTPS streams rank first, dead streams are
  skipped automatically, ⏮/⏭ step through the list.
- **Favorites page** — tap the heart (♡) on any station or in the player
  bar; your favorites persist in the local SQLite DB, with a
  "Play a favorite" shuffle.

## How it's built

- Frontend: React + Tailwind, bundled with `Bun.build` (`bun run build`)
- Backend: `Bun.serve` + SQLite (`bun:sqlite`) via Drizzle ORM
- API: `POST /api/<action>` — `getCountries`, `getStations`,
  `searchStations`, `getFavorites`, `toggleStationFavorite`

## Project layout

| Path | What it is |
|---|---|
| `client/src/` | React frontend (globe, station panel, player, search, favorites) |
| `client/src/geo.ts` | Country names + centroid coordinates for the globe |
| `server/standalone.ts` | HTTP server: API routes + static file serving |
| `server/actions.ts` | Action implementations (Radio Browser directory logic) |
| `server/db.ts` | SQLite + Drizzle setup |
| `server/schema.ts` | Drizzle schema |
| `drizzle/` | SQL migrations |
