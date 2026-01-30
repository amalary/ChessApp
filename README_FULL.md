# ChessApp � Full Stack Overview

This repo contains a chess-puzzle solver prototype with a FastAPI backend, a Next.js 16 frontend (App Router + a small legacy /pages area), Auth0-based auth, optional OpenAI Vision/GCS integration, and Jenkins-based CI/CD with Docker builds.

## Repository Layout
- backend/ � FastAPI service that exposes /health and a protected /solve endpoint.
- frontend/ � Next.js app with Auth0 integration, a simple solver UI (/pages) and a richer test UI at /solve-test.
- CI_CD/ � Jenkins pipeline plus lint configs for both stacks.
- keys/ � placeholder for service accounts (not checked in).
- main.py (root) � legacy FastAPI stub not used by the main app.

## How It Works (high level)
- Frontend asks Auth0 for user login and tokens. It can fetch an access token via /auth/access-token.
- Users upload a chess-puzzle image from the UI. The frontend POSTs the image to the backend /solve with Authorization: Bearer <token>.
- Backend validates the JWT with Auth0 (RS256). The current implementation returns a stubbed solution (Qh7#) and echoes user info; it is wired to later call OpenAI Vision and optionally Google Cloud Storage.
- Health checks are exposed at /health for uptime monitoring.

## Backend (FastAPI)
Location: backend/app
Key files: app/main.py, app/auth0.py, app/routers/health.py
Endpoints:
- GET / � "Backend is running" message.
- GET /health � status probe.
- POST /solve � protected by Auth0; expects multipart/form-data with image; currently returns stub.
Auth: Validates RS256 tokens from Auth0 using AUTH0_DOMAIN + AUTH0_AUDIENCE. Missing env vars fail fast on startup.
Run locally:
1) cd backend
2) Create .env with required variables (see below).
3) uvicorn app.main:app --reload --env-file ../.env
Important env vars:
- AUTH0_DOMAIN, AUTH0_AUDIENCE (required for auth).
- OPENAI_API_KEY (planned for vision solving).
- GCP_PROJECT_ID, GCS_BUCKET, GOOGLE_APPLICATION_CREDENTIALS (planned for image storage).
- PORT defaults to 8000 via uvicorn command.
Dependencies: See backend/requirements.txt (FastAPI, uvicorn, auth0 via PyJWKClient, GCS libs, OpenAI planned).
Docker: backend/Dockerfile installs requirements and runs uvicorn on 0.0.0.0:8000.

## Frontend (Next.js 16)
Location: frontend/
Auth: Uses @auth0/nextjs-auth0; middleware mounted via proxy.ts. Providers set up in src/app/layout.tsx and src/app/providers.tsx.
Key routes:
- / (App Router) � default Next starter page (customize in src/app/page.tsx).
- /pages (legacy) � simple solver form posting to backend /solve with an access token.
- /solve-test � neumorphic test UI to upload an image and view solver output; uses NEXT_PUBLIC_AUTH0_TEST_TOKEN for manual token injection.
- /auth/* � Auth0 routes exposed by the SDK (login, callback, logout, access-token, profile).
Run locally:
1) cd frontend && npm install
2) Create .env.local (see env section).
3) npm run dev (default http://localhost:3000)
Key env vars (frontend):
- APP_BASE_URL or AUTH0_BASE_URL (e.g., http://localhost:3000)
- AUTH0_DOMAIN
- AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET
- AUTH0_SECRET (session cookie encryption)
- AUTH0_AUDIENCE (must match backend AUTH0_AUDIENCE)
- NEXT_PUBLIC_BACKEND_URL (e.g., http://127.0.0.1:8000)
- NEXT_PUBLIC_AUTH0_TEST_TOKEN (only for /solve-test manual calls)
- NEXT_PUBLIC_BASE_PATH (optional if app is deployed under a subpath)
Styling: globals.css defines light/dark neumorphic tokens. Theme toggled via next-themes.
Build/start: npm run build && npm start.
Docker: frontend/Dockerfile builds with SKIP_AUTH0_VALIDATION=1 to allow missing env vars at build time; runs on Node 20 Alpine with glibc compat.

## End-to-End Flow (local dev)
1) Start backend: uvicorn app.main:app --reload --env-file ../.env from backend/.
2) Start frontend: npm run dev from frontend/.
3) Log in via Auth0 (visit /auth/login). The legacy /pages solver will fetch an access token via /auth/access-token. For the /solve-test page, set NEXT_PUBLIC_AUTH0_TEST_TOKEN to a valid JWT and browse to /solve-test.
4) Upload a puzzle image; the frontend sends it to /solve; backend returns a stub solution and echoes user info.

## CI/CD
- Jenkins pipeline: CI_CD/Jenkinsfile
  - Checks out code.
  - Lints frontend inside node:22-alpine (npm install + npx eslint .).
  - Lints backend with ruff and black (line length 100 per CI_CD/linting/backend.pyproject.toml).
  - Placeholder stage for unit tests.
  - Builds Docker images for frontend and backend and pushes to Docker Hub using stored credentials.
- Lint configs: CI_CD/linting/frontend.eslintrc.cjs and backend.pyproject.toml.

## Environment Files
- .env.sample (repo root) lists core backend/OpenAI/GCP vars.
- frontend/.env.local (create) for Auth0 + frontend vars.
- backend/.env (create) for AUTH0_DOMAIN/AUDIENCE, OpenAI, GCP.
Do not commit secrets. keys/ should store service account JSON if using GCS; keep it out of VCS.

## Troubleshooting
- Auth errors: ensure AUTH0_DOMAIN/AUDIENCE match between frontend and backend; verify JWT is RS256 and unexpired.
- 401 from /solve in /solve-test: set NEXT_PUBLIC_AUTH0_TEST_TOKEN or log in and use the /pages flow which fetches an access token.
- Build failures in Docker: supply SKIP_AUTH0_VALIDATION=1 (already set in Dockerfile) when building frontend if env vars are absent.
- Uvicorn fails on startup: check that AUTH0 env vars are set; app/auth0.py raises if missing.
- Cloud SQL migrations: Cloud SQL does not accept direct TCP from CI/laptops by default. Run the Cloud SQL Auth Proxy locally/CI and set `DB_HOST=127.0.0.1`, `DB_PORT=5432`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` for Alembic. On Cloud Run, set `CLOUD_SQL_CONNECTION_NAME` to use the unix socket at `/cloudsql/<INSTANCE>`.

## Next Steps (suggested)
- Replace the stub solver with OpenAI Vision + GPT for SAN move output.
- Persist uploaded puzzles/solutions to GCS.
- Add Jest/React Testing Library and Pytest coverage; wire into Jenkins tests stage.
- Harden error handling and add rate limiting/logging for /solve.



** Check in meeting later today   1 **  
** Research another vision API model ** = Gemini Pro 3 Vision model 

** Plan out the database set up **   

''' For this project, Google Cloud Storage (GCS) is used to store uploaded chess puzzle images, while Firestore (Native mode) stores all application data such as users, upload metadata, and solved puzzle results (SAN moves, status, timestamps).
Images are uploaded securely using signed URLs, and the backend processes them asynchronously before writing results back to Firestore.
This setup keeps file storage and structured data separate, scales automatically, and minimizes backend complexity.
BigQuery can be added later for analytics without changing the core architecture. ''' 

** Figure out how to solve the authentication error maybe needing a new access token or upgrade my current account** Bring up in 1 on 1 
** Persist uploaded puzzles/solutions to GCS. ** 
** Add Jest/React Testing Library and Pytest coverage; wire into Jenkins tests stage. ** 
**  Harden error handling and add rate limiting/logging for /solve. ** 
