```json
{
  "title": "Troubleshooting",
  "slug": "troubleshooting",
  "category": "support",
  "related_routes": ["/solve", "/assistant", "/dashboard", "/login-test"],
  "related_features": ["upload troubleshooting", "solve troubleshooting", "assistant troubleshooting", "auth troubleshooting"],
  "intended_audience": "end_user",
  "last_updated": "AUTO_GENERATED"
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
Before deeper debugging:
1. Refresh the page.
2. Retry with a smaller, clearer image.
3. Confirm backend URL and app session are active.

## How It Works
### User Actions
- Identify where failure occurs (upload, solve, dashboard, assistant).
- Capture exact on-screen error text.
- Retry with one controlled change at a time.

### System Behavior
- Frontend shows backend `detail` or `error` text when available.
- Backend applies file checks, rate limits, and solve validation.
- Assistant applies auth checks and response guardrails.

### Edge Cases
- Browser can accept a file that backend rejects.
- Low-confidence board extraction can produce weak solve outcomes.

## Step-by-Step Usage
### Identify the Symptom
Classify the issue first:
- Upload fails
- Solve fails
- Solve returns no mate
- Assistant fails
- Login/token error

### Isolate the Area
Use this map:
- Upload errors: file type/size or image quality.
- Solve errors: FEN/position/engine/backend issues.
- Assistant errors: token/context/guardrails.

### Apply Resolution Steps
1. Re-upload a cleaner image (PNG/JPG/WEBP).
2. Re-check side-to-move selector.
3. Re-select first move and solve again.
4. Re-authenticate if assistant token error appears.

## Expected Output
### Resolution Signals
- Upload preview appears.
- Solve returns SAN line or a clear "no mate" result.
- Assistant returns a normal response instead of token/guardrail error.

### Escalation Criteria
Escalate to maintainers if:
- Reproducible failures continue after multiple clean retries.
- Backend repeatedly returns 5xx errors.
- Assistant always fails despite valid auth and recent solved puzzle.

## Common Errors
### Upload and Solve Failures
- **Issue:** `Invalid file type or size.`
  - Cause: unsupported MIME type or image >10MB.
  - Fix: convert/compress to PNG/JPEG/WEBP under 10MB.

- **Issue:** Puzzle cannot be read or appears incorrect.
  - Cause: blurry/obstructed board.
  - Fix: crop tightly, improve clarity, retry.

- **Issue:** `Invalid FEN returned from Gemini` or `Invalid chess position detected`.
  - Cause: extraction produced invalid board state.
  - Fix: upload a cleaner board image and retry.

- **Issue:** `No forced mate (1-3)`.
  - Cause: no forced mate in supported range.
  - Fix: verify puzzle type; retry if image quality was poor.

- **Issue:** solve seems slow or blocked.
  - Cause: backend busy/rate limited or dependency pressure.
  - Fix: wait briefly and retry.

### Authentication Failures
- **Issue:** Missing or invalid access token.
  - Cause: expired/missing session.
  - Fix: sign in again and retry.

<!-- REVIEW_NEEDED: Confirm production user-facing login route and session refresh flow. -->

### Assistant Request Failures
- **Issue:** Missing puzzle context prompt.
  - Cause: no recent solved puzzle context available.
  - Fix: solve a puzzle first, then ask again.

- **Issue:** Guardrail refusal.
  - Cause: unsafe instruction or blocked tool request pattern.
  - Fix: rephrase as a chess or app-usage question.

## Tips
### Fast Isolation Tips
- Change one variable at a time (image, side selector, question text).
- Keep a copy of exact error text.

### Reproducibility Tips
- Retry with the same image and same steps.
- Note whether failure is consistent or intermittent.
