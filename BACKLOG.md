# BACKLOG

Claim a task by writing your name next to it before starting. Only touch that task's files. Task details are in `ARCHITECTURE.md` → Tasks.

## Next step
Finish T1 (download all Turkey years) and T2 (mocks + backend skeleton); then start T3 (frontend from mocks) and T4/T5 (dataset + harmonization).

## In progress
- T1 fetch script + Turkey download – lead session (Barış)
- T2 mock generator + backend skeleton – lead session (Barış)

## Open
- T3 frontend scaffold from mocks (`frontend/`)
- T4 build_dataset.py
- T5 harmonization model + validation (Opus)
- T6 live /api/calendar
- T7 live /api/harmonization + hotspots.csv
- T8 frontend: validation panel, insights, toggle, CSV
- T9 draw-your-own AOI
- T10 deploy (needs GitHub remote, Render, Vercel)
- T11 2026 via FIRMS API (needs MAP_KEY)
- T12 cropland vs wildland (stretch)
- T13 more countries (stretch)
- T14 integration review
- T15 slides, README, license, AI-use statement

## Team to-do (humans)
- Request a FIRMS MAP_KEY: https://firms.modaps.eosdis.nasa.gov/api/map_key/ (arrives by email) → put in `.env` as `FIRMS_MAP_KEY=...` (never commit)
- Create the GitHub repo and add it as `origin`
- Render + Vercel accounts
- Check the challenge "Resources" tab and the Project Submission Guide (video length limit) – unreadable from the dev machine

## Done
- Recon: FIRMS archive + API, challenge rules, competitors (Nov 14)
- ARCHITECTURE.md v1 with contract (Nov 14)
- Node 26 installed on Barış's machine

## Decisions
- Nov 14 – Time unit is the 8-day period (46/yr) – MODIS user guide warns of sampling bias below ~8 days.
- Nov 14 – Harmonized unit is "VIIRS-equivalent hotspots"; 2012+ uses observed VIIRS, earlier years scaled MODIS with a band.
- Nov 14 – Start with Turkey only from the no-key country archive; 2026 comes from the API once we have a key.
- Nov 14 – No single scaling factor, no FRP-based unit – contradicted by real data (see ARCHITECTURE → Real data findings).
