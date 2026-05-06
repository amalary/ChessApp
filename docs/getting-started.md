```json
{
  "title": "Getting Started",
  "slug": "getting-started",
  "category": "onboarding",
  "related_routes": ["/login-test", "/solve-test", "/dashboard"],
  "related_features": ["authentication", "puzzle solve flow", "dashboard navigation"],
  "intended_audience": "end_user",
  "last_updated": "AUTO_GENERATED"
}
```

# Getting Started

## Overview
### Audience
This guide is for players using the web app to upload puzzle images, solve mate puzzles, and review progress.

### Prerequisites
- A modern browser.
- Access to the app frontend.
- A clear chess puzzle image (PNG, JPG, or WEBP recommended).

<!-- REVIEW_NEEDED: Confirm whether your production entry point should be /dashboard, /solve-test, or a custom landing page. -->

## How It Works
### User Actions
1. Open the app.
2. Sign in (if your deployment requires it).
3. Go to puzzle solving.
4. Upload a puzzle image and run solve.
5. Open Dashboard for analytics and settings.

### System Behavior
- The solve flow sends your image to the backend `/solve` endpoint.
- The backend extracts a position, validates it, and searches for mate in 1 to 3.
- Results are shown as solution moves plus position-check metadata.

### Edge Cases
- If authentication is missing for protected routes, requests can fail with access-token errors.
- If the image is unclear or invalid, solve can fail before returning a line.

## Step-by-Step Usage
### Sign In
- If you are using the local test flow, open `/login-test` and use signup/login.
- For Auth0-backed assistant calls, a valid Auth0 session is required.

<!-- REVIEW_NEEDED: Confirm whether local auth should remain user-facing or development-only. -->

### Access Puzzle Solve
- Open `/solve-test`.
- Upload an image.
- Select your first move on the board overlay.
- Press **Solve**.

### Access Dashboard
- Open `/dashboard`.
- Use the left sidebar to switch between Dashboard, Analytics, Agent, and Settings.
- Open `/agent` to jump directly to the Agent section via redirect.

## Expected Output
### Successful States
- A solution line appears under **Solution**.
- Position-check metadata appears (side to move, confidence, attempts, mate status).
- Solved submissions are stored locally for analytics and assistant context.

### Verification Checklist
- You can see your uploaded image preview.
- **Solve** is enabled after first-move selection.
- A result appears in the Solution panel without backend errors.

## Common Errors
### Authentication Issues
- "Missing Auth0 access token. Please sign in again." when sending assistant messages.
- Invalid or missing bearer token on protected backend routes.

### Connectivity Issues
- Backend unreachable (network failure).
- Service unavailable if backend dependencies (for example Redis) are not ready.

## Tips
### First Session Tips
- Start with a high-contrast puzzle image.
- Confirm side to move before solving.

### Account and Session Tips
- Keep your session active before using assistant features.
- If assistant calls fail, refresh and sign in again.
