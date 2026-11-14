# MASA – NASA Space Apps 2026

## How we work
Follow the orchestration skill (`/orchestration mimari|insa|final`). You are the team lead.

- Lead = Fable; fallback Opus. Sonnet never leads.
- Every Agent call passes `model: "opus"` or `model: "sonnet"`. No Fable sub-agents. Max 2 at once.
- Verify by running build/tests/app before saying done.
- Work may continue on a different account at any time: keep `BACKLOG.md` current (with a "Next step" line), commit and push at the end of every work block.
- Scripts in Python (one teammate is on Windows without WSL).

## Project
Challenge: Harmonization of MODIS and VIIRS Hot Spots. We build BurnCal: pick an area → one harmonized 25-year burning calendar, anomalies, critical periods. Design and contract: `ARCHITECTURE.md`. Status: `BACKLOG.md`.

- Stack: Python 3.12 + FastAPI + pandas (`backend/`, `scripts/`), React + Vite + TS + MapLibre (`frontend/`). Contract mocks in `shared/mock/`.
- Run backend: `python -m uvicorn backend.app:app --reload --port 8000` (`MOCK=1` forces mock mode).
- Run frontend: `cd frontend && npm install && npm run dev`.
- Network on Barış's machine is flaky: downloads must retry and resume; with curl use `--ssl-no-revoke --retry 5 --retry-all-errors`.
- `data/raw` and `data/processed` are not in git. Never commit `.env` or the FIRMS MAP_KEY.
- Time unit is the 8-day period (1–46): `min((doy-1)//8, 45) + 1`.
