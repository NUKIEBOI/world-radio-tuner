# World Radio Tuner

**Spin the earth, hear the planet.** A Radio Garden–style globe of live
internet radio: drag the world around, tap a country, and listen to its
music stations right in the page — no radio hardware, no new tabs.

This is a full-stack TypeScript app (React + Drizzle + SQLite). The live app
runs on the hosted artifact runtime; this repo holds the complete source.

## What it does

- **Spinning globe** — an interactive globe (Meta map runtime, globe
  projection) with a dot for every country that has stations. Drag to turn
  the earth, tap a dot to open that country.
- **Live station directory** — station data comes from
  [Radio Browser](https://www.radio-browser.info/), the free community-run
  index of internet radio (~55,000 working stations across ~200 countries).
  Per country you get its top stations by community votes, filterable by
  genre (pop, rock, jazz, classical, electronic, latin, folk…), plus a
  worldwide station search.
- **In-page player** — streams play directly from each station's own server
  to your browser. HTTPS streams are ranked first (secure pages can't play
  plain-http audio), dead streams are skipped automatically, and ⏮/⏭ step
  through the list. "Surprise me" shuffles a random station from the
  country you're browsing.
- **Favorites** — star stations and they stay one tap away.

## Project layout

| Path | What it is |
|---|---|
| `client/src/` | React frontend (globe, country browser, station panel, player) |
| `client/src/geo.ts` | Country names + centroid coordinates (mledoze/countries dataset), joined with the live directory by ISO code |
| `server/src/actions.ts` | Server actions (Radio Browser directory fetch + cache, station lists, search, favorites) |
| `server/src/schema.ts` | Drizzle schema |
| `drizzle/` | SQL migrations |

## About this repo

This repo holds the complete source of the World Radio Tuner. The app itself
runs on the hosted Muse artifact runtime (open it from the shared card) — it
depends on the internal `@hatch/space-sdk` package, so it can't be installed
and run with a plain `bun install` outside that environment. Clone it to read
the code or port it.
