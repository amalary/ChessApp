```json
{
  "title": "Assistant",
  "slug": "assistant",
  "category": "assistant",
  "related_routes": ["/assistant", "/dashboard?section=Agent", "/agent"],
  "related_features": ["assistant chat", "puzzle-grounded responses", "guardrails", "theme and hint support"],
  "intended_audience": "end_user",
  "last_updated": "AUTO_GENERATED"
}
```

# Assistant

## Overview
### Assistant Scope
The Chess Assistant helps with:
- Explaining solver moves
- Giving progressive hints
- Identifying likely tactical themes
- Answering selected app-navigation questions

### Input Context Requirements
For puzzle-specific answers, the assistant needs puzzle context from recent solved submissions (FEN + solver line).

## How It Works
### User Actions
1. Open Agent from dashboard sidebar or `/agent`.
2. Enter a question or use a starter chip.
3. Send message.

### System Behavior
- Frontend builds a request to backend `POST /assistant`.
- Request includes:
  - `user_message`
  - `requested_mode` (auto-detected)
  - latest puzzle context when available
- Backend validates context and enforces guardrails before responding.

### Edge Cases
- If no puzzle context exists, puzzle-specific requests return a helpful prompt to solve/upload first.
- If Auth0 token is missing, chat shows sign-in token error.

## Step-by-Step Usage
### Open Agent Section
- Open `/dashboard` and click **Agent**, or open `/agent`.

### Ask Puzzle Questions
Examples:
- "Explain my last puzzle"
- "Give me hint 2"
- "What tactical theme is this?"

### Ask App Navigation Questions
Examples:
- "How do I use Puzzle Lab?"
- "What does analytics show?"

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
- Move references are validated against legal moves and solver data.
- Checkmate claims are limited when line verification is missing.

## Common Errors
### Missing Puzzle Context
- Message example: "Please solve or upload a puzzle first so I have a FEN to analyze."
- Fix: solve at least one puzzle, then retry assistant question.

### Guardrail Refusals
- Prompt-injection-like requests are refused.
- Tool requests outside allowed chess-safe list are refused.

### Authentication and Request Issues
- Missing Auth0 token can block assistant requests.
- Backend connectivity failures return request errors in chat.

## Tips
### Writing Better Questions
- Ask one concrete question per message.
- If you want hints, specify level (for example: "hint 1" or "hint 3").

### Verifying Assistant Output
- Treat assistant output as guidance.
- Re-check critical lines on the board.

## Planned or Partial Areas
- **Planned feature � not currently available:** documentation-grounded retrieval (RAG) for broader app help.
- Current app-navigation answers are keyword-based, not yet retrieval-backed.
- Theme classification is heuristic and may be conservative.

<!-- REVIEW_NEEDED: Confirm rollout status for production Auth0 session support in the Agent UI path. -->

*Will have to tackle soon. * 