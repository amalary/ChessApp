```json
{
  "title": "Assistant",
  "slug": "assistant",
  "category": "assistant",
  "related_routes": ["/assistant", "/dashboard?section=Agent", "/agent"],
  "related_features": ["assistant chat", "puzzle-grounded responses", "guardrails", "mode-based responses"],
  "intended_audience": "end_user",
  "last_updated": "2026-05-12"
}
```

# Assistant

## Overview
### Assistant Scope
The Chess Assistant helps with:
- Explaining solver moves
- Giving progressive hints
- Identifying tactical themes
- Answering selected app navigation questions

### Input Context Requirements
For puzzle-specific answers, the assistant needs recent puzzle context (FEN + solver line).

## How It Works
### User Actions
1. Open Agent from dashboard sidebar or `/agent`.
2. Enter a question or use a starter chip.
3. Send message.

### System Behavior
- Frontend calls backend `POST /assistant`.
- Request includes:
  - `user_message`
  - `requested_mode` (`hint`, `explain`, `theme`, or `followup`)
  - latest puzzle context when available
- Backend validates Auth0 bearer token and applies guardrails before responding.

### Edge Cases
- If no puzzle context exists, puzzle-specific requests ask you to solve/upload first.
- If Auth0 token is missing, chat shows a sign-in/token error.

## Step-by-Step Usage
### Open Agent Section
- Open `/dashboard` and click **Agent**, or open `/agent`.

### Ask Puzzle Questions
Examples:
- `Explain my last puzzle`
- `Give me hint 2`
- `What tactical theme is this?`

### Ask App Navigation Questions
Examples:
- `How do I use Puzzle Lab?`
- `What does analytics show?`

## Expected Output
### Response Fields
Backend response includes:
- `response_text`
- `mode`
- `theme_tags`
- `confidence`
- `referenced_move`
- `guardrail_triggered`
- `guardrail_reason`

### Grounding and Confidence Signals
- Move references are validated against legal moves and solver context.
- Confidence reflects how strongly the assistant can ground the answer.

## Common Errors
### Missing Puzzle Context
- Message example: `Please solve or upload a puzzle first so I have a FEN to analyze.`
- Fix: solve at least one puzzle, then retry.

### Guardrail Refusals
- Unsafe/prompt-injection-like requests are refused.
- Out-of-scope tool-action requests are refused.

### Authentication and Request Issues
- `Missing Auth0 access token. Please sign in again.` blocks assistant requests.
- Invalid bearer token returns backend `401`.

## Tips
### Writing Better Questions
- Ask one concrete question per message.
- Specify hint level (`hint 1`, `hint 2`, `hint 3`).

### Verifying Assistant Output
- Treat assistant output as guidance.
- Re-check critical lines on the board.
