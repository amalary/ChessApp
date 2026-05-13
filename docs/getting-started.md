```json
{
  "title": "Getting Started",
  "slug": "getting-started",
  "category": "onboarding",
  "related_routes": ["/login-test", "/solve-test", "/dashboard"],
  "related_features": ["local signup/login", "puzzle solve flow", "dashboard navigation"],
  "intended_audience": "end_user",
  "last_updated": "2026-05-12"
}
```

# Getting Started

## Overview
### Audience
This guide is for players using local signup/login, puzzle solving, dashboard analytics, and assistant tools.

### Prerequisites
- A modern browser.
- Frontend app access.
- Backend running on `127.0.0.1:8010`.
- A clear chess puzzle image (PNG/JPEG/WEBP recommended).

## How It Works
### User Actions
1. Open `/login-test`.
2. Sign up or log in with local auth.
3. Solve puzzles in `/solve-test`.
4. Open `/dashboard` to review progress.
5. Use Agent from Dashboard when Auth0 session/token is available.

### System Behavior
- Local auth calls frontend `/api/local-auth/*`, which proxies to backend `/auth/signup` and `/auth/login`.
- Solve flow sends image data to backend `POST /solve`.
- Dashboard reads local stored history and can hydrate from `/puzzles/submissions` for logged local-auth users.

### Edge Cases
- Assistant messages can fail with token errors if Auth0 access token is unavailable.
- Solve can fail when image quality is too low for FEN extraction.

## Step-by-Step Usage
### Sign In (Local Auth)
- Open `/login-test`.
- Use **Signup** to create an account or **Login** for existing local account.

### Solve a Puzzle
- Open `/solve-test`.
- Upload image.
- Select your first move.
- Press **Solve**.

### Open Dashboard
- Open `/dashboard`.
- Use sidebar sections for Dashboard, Analytics, Agent, and Settings.

## Expected Output
### Successful States
- Signup/login success message appears.
- Solve returns SAN/UCI line or a clear no-mate result.
- Dashboard and analytics update from stored submissions.

### Verification Checklist
- `/login-test` accepts credentials.
- `/solve-test` shows image preview and solve output.
- `/dashboard` loads navigation and panels.

## Common Errors
### Authentication Issues
- `Missing Auth0 access token. Please sign in again.` in Agent chat.
- `Cannot reach backend auth service ...` when frontend cannot proxy to backend `/auth/*`.

### Connectivity Issues
- Backend unreachable from frontend (`127.0.0.1:8010` not running).
- Backend dependency failures (for example Redis not available at startup).

## Tips
### First Session Tips
- Start with high-contrast board images.
- Confirm side to move before solving.

### Assistant Tips
- Solve at least one puzzle first so Agent has puzzle context.
- Re-authenticate if Agent returns Auth0 token errors.
