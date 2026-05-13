# ChessApp - Full Stack Overview

This repository contains a chess puzzle workflow with a FastAPI backend and a Next.js frontend.

## Current Architecture
- Frontend: Next.js 16 app (`frontend/`) with routes like `/login-test`, `/solve-test`, `/dashboard`, and `/agent`.
- Backend: FastAPI app (`backend/app`) with routes:
  - `GET /health`
  - `POST /solve`
  - `POST /auth/signup`
  - `POST /auth/login`
  - `POST /assistant`
  - `GET /puzzles/submissions`
  - `GET /puzzles/analytics/difficulty-buckets`
- AI/engine path for solve: image -> Gemini FEN extraction -> Stockfish mate search (mate in 1..3).
- Persistence:
  - Local browser storage for dashboard/theme and puzzle history.
  - Local-auth-linked puzzle submissions persisted in SQL when `X-Local-Auth-User-Id` is present.
- Redis is required at backend startup for rate limiting and engine lock controls.

## Auth Model (Current)
- Local auth is available via backend `/auth/signup` and `/auth/login`, proxied from frontend `/api/local-auth/*`.
- Assistant route (`POST /assistant`) requires an Auth0 bearer token (`Authorization: Bearer ...`).
- Solve route (`POST /solve`) does not require Auth0 token, but can optionally attach local-auth user context via `X-Local-Auth-User-Id`.

## Local Development

### Preferred one-command flow
From repo root:

```powershell
npm run dev:all
```

This starts:
- Cloud SQL Proxy on `127.0.0.1:5432`
- Backend on `127.0.0.1:8010`
- Frontend on `http://localhost:3000`

Stop services:

```powershell
npm run dev:stop
```

Logs are written to `.runlogs/`.

### Manual flow
1. Start Cloud SQL proxy from repo root:

```powershell
.\backend\tools\cloud-sql-proxy.exe --credentials-file=.\keys\sa.json --port=5432 chessapp-477519:us-west2:chess-app-project
```

2. Start backend from `backend/`:

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:DB_USER='app_user'
$env:DB_PASSWORD='MalaryOctober10'
$env:DB_NAME='chessapp'
$env:DB_HOST='127.0.0.1'
$env:DB_PORT='5432'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

3. Start frontend from `frontend/`:

```powershell
npm run dev
```

## Environment Notes
- Backend reads env vars from `.env` (repo root or discovered parent paths).
- Assistant/Auth0 flow requires `AUTH0_DOMAIN` and `AUTH0_AUDIENCE` on backend.
- Solve flow requires `GOOGLE_API_KEY` (or `GEMINI_API_KEY` which is mapped to `GOOGLE_API_KEY`).
- Backend requires reachable Redis (`REDIS_URL`, default `redis://localhost:6379/0`).

## Key User Routes
- `http://localhost:3000/login-test` for local signup/login then solve flow.
- `http://localhost:3000/solve-test` for puzzle upload and solving.
- `http://localhost:3000/dashboard` for analytics/settings/agent access.
- `http://localhost:3000/agent` redirects to dashboard agent section.

## Troubleshooting Quick Notes
- `Missing Auth0 access token...` in assistant chat: sign in through Auth0 routes (`/auth/login`) and retry.
- `Invalid file type or size.`: ensure PNG/JPEG/WEBP under 10MB.
- Backend startup fails with Redis error: bring Redis up first.
- `/auth/signup` or `/auth/login` 503: verify DB env vars and Cloud SQL proxy status.
