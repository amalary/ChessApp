```json
{
  "title": "Troubleshooting",
  "slug": "troubleshooting",
  "category": "support",
  "related_routes": ["/solve-test", "/assistant", "/dashboard", "/login-test"],
  "related_features": ["upload troubleshooting", "solve troubleshooting", "assistant troubleshooting", "auth troubleshooting"],
  "intended_audience": "end_user",
  "last_updated": "2026-05-12"
}
```

# Troubleshooting

## Overview
### Issue Categories
This page covers common issues with:
- Uploading puzzle images
- Solving puzzles
- Assistant chat
- Login/session state

### Before You Start
1. Refresh page.
2. Retry with a smaller, clearer image.
3. Confirm backend is running at `127.0.0.1:8010`.

## How It Works
### User Actions
- Identify where failure occurs (upload, solve, dashboard, assistant).
- Capture exact error text.
- Retry with one controlled change at a time.

### System Behavior
- Frontend surfaces backend `detail` text when available.
- Backend enforces upload checks, rate limits, and solve validation.
- Assistant requires valid Auth0 bearer token.

## Step-by-Step Usage
### Identify the Symptom
Classify issue first:
- Upload fails
- Solve fails
- Solve returns no mate
- Assistant fails
- Login/token error

### Isolate the Area
- Upload errors: file type/size/image quality.
- Solve errors: FEN/position/engine/backend dependencies.
- Assistant errors: token/context/guardrails.

### Apply Resolution Steps
1. Re-upload cleaner image (PNG/JPG/WEBP).
2. Re-check side-to-move selector.
3. Re-select first move and solve again.
4. Re-authenticate when assistant token errors appear.

## Common Errors
### Upload and Solve Failures
- **Issue:** `Invalid file type or size.`
  - Cause: unsupported MIME or image >10MB.
  - Fix: convert/compress to PNG/JPEG/WEBP under 10MB.

- **Issue:** `Invalid FEN returned from Gemini` or `Invalid chess position detected`.
  - Cause: extraction produced invalid board state.
  - Fix: upload clearer board image.

- **Issue:** `No forced mate (1-3)`.
  - Cause: no forced mate in supported range.
  - Fix: verify puzzle type and retry with clearer input if needed.

- **Issue:** `Stockfish not found...`.
  - Cause: backend cannot resolve Stockfish binary path.
  - Fix: install Stockfish and set `STOCKFISH_PATH`.

### Auth and Assistant Failures
- **Issue:** `Cannot reach backend auth service ...`.
  - Cause: frontend local-auth proxy cannot reach backend `/auth/*`.
  - Fix: start backend and recheck `BACKEND_URL` / `NEXT_PUBLIC_BACKEND_URL`.

- **Issue:** `Missing Auth0 access token. Please sign in again.`
  - Cause: assistant route requires Auth0 bearer token.
  - Fix: sign in via Auth0 and retry.

- **Issue:** `Please solve or upload a puzzle first...`
  - Cause: no puzzle context for assistant grounding.
  - Fix: solve a puzzle first.

## Tips
### Fast Isolation Tips
- Change one variable at a time.
- Keep exact error text for comparison.

### Reproducibility Tips
- Retry with same image and same steps.
- Note if issue is consistent or intermittent.
