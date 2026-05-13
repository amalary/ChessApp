# ChessApp   


                        +-----------------------------+
                        |           User              |
                        |  - Web browser              |
                        |  - On laptop / phone        |
                        +--------------+--------------+
                                       |
                                       | HTTPS
                                       v
                        +-----------------------------+
                        |        Frontend (Next.js)   |
                        |  - React + TypeScript       |
                        |  - Runs on Vercel/GCP/Docker|
                        +--------------+--------------+
                                       |
                                       | HTTP POST /solve
                                       |  (multipart/form-data with image)
                                       v
+---------------------------+     +------------------------------+
|  Optional Cloud Services  |     |  Backend API (FastAPI)       |
|  (GCS / external APIs)    |<--->|  - /health, /solve           |
|  - puzzle storage (opt)   |     |  - /auth, /assistant         |
|  - platform integrations  |     |  - /puzzles/* analytics data |
+-------------+-------------+     +------------------------------+
              ^                                   |
              |                                   |
              |                                   | HTTPS (AI API)
              |                                   v
              |                      +------------------------------+
              |                      |     Gemini + Stockfish      |
              |                      |  - Reads chess puzzle image |
              |                      |  - Returns SAN moves        |
              |                      +------------------------------+
              |
              |
       (DevOps / Infra)
+-------------+-------------+
|  Jenkins CI/CD            |
|  - Builds Docker images   |
|  - Lints/tests frontend   |
|  - Lints/tests backend    |
|  - Pushes to registry     |
+---------------------------+

## Run Locally (Bash)

Use 3 separate Bash terminals.

### Terminal 1 (repo root): Start Cloud SQL Proxy
Run from: `ChessApp/`

```bash
cd /path/to/ChessApp
./backend/tools/cloud-sql-proxy.exe "chessapp-477519:us-west2:chess-app-project --credentials-file=keys/sa.json --port=5432"
```

### Terminal 2 (backend): Start FastAPI backend
Run from: `ChessApp/backend/`

```bash
cd /path/to/ChessApp/backend

# Prevent old shell values from overriding DB_* vars
unset DATABASE_URL

export DB_USER=app_user
export DB_PASSWORD=MalaryOctober10
export DB_NAME=chessapp
export DB_HOST=127.0.0.1
export DB_PORT=5432

./.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

### Terminal 3 (frontend): Start Next.js frontend
Run from: `ChessApp/frontend/`

```bash
cd /path/to/ChessApp/frontend
npm run dev
```

### Verify backend is running
Run from any terminal:

```bash
curl http://127.0.0.1:8010/health
```

Expected response:

```json
{"status":"ok"}
```

### Test routes
- Local auth + solve flow: `http://localhost:3000/login-test`
- Solve page: `http://localhost:3000/solve-test`

## One-Command Startup (PowerShell)

From repo root (`ChessApp/`), run:

```powershell
npm run dev:all
```

From Bash/Git Bash (same command), run:

```bash
npm run dev:all
```

This command starts:
- Cloud SQL Proxy on `127.0.0.1:5432`
- Backend on `127.0.0.1:8010`
- Frontend on `http://localhost:3000`

To stop all services started by this launcher:

```powershell
npm run dev:stop
```

Bash/Git Bash:

```bash
npm run dev:stop
```

Launcher logs are written to `.runlogs/`.
