```json
{
  "title": "Solving Puzzles",
  "slug": "solving-puzzles",
  "category": "core-feature",
  "related_routes": ["/solve-test", "/solve"],
  "related_features": ["board transcription", "FEN extraction", "Stockfish solve", "solution output"],
  "intended_audience": "end_user",
  "last_updated": "2026-05-12"
}
```

# Solving Puzzles

## Overview
### Solve Scope
Current solve checks forced mate in:
- Mate in 1
- Mate in 2
- Mate in 3

### Solve Preconditions
- Puzzle image is uploaded.
- You selected your first move on the board overlay.

## How It Works
### User Actions
1. Upload puzzle image.
2. Select source and destination squares for your first move.
3. Press **Solve**.
4. Review solution and position-check results.

### System Behavior
- Frontend sends multipart form data to `/solve`:
  - `image`
  - `expected_side_to_move`
- Backend pipeline:
  1. Extract board/FEN from image.
  2. Validate position.
  3. Run Stockfish mate search (1..3).
  4. Return FEN, confidence, mate status, SAN and UCI moves.

### Edge Cases
- If no forced mate in 1..3 is found, solve returns no mate line.
- If extracted FEN is invalid, solve fails with validation error.
- If engine is missing, solve fails with engine error.

## Step-by-Step Usage
### Start Solve Request
- Open `/solve-test`.
- Upload image and set side to move.
- Click one square for source and one for destination.
- Press **Solve**.

### Review Position Check
Check the metadata block for:
- Side to move
- Vision confidence
- Vision attempts
- Mate status

### Review Solution Output
- Solution lines are shown in SAN format.
- If no mate is found in range, output can show `No forced mate (1-3)`.
- First-move evaluation appears below when available.

## Expected Output
### Position Metadata
Typical fields shown:
- Side to move
- Vision confidence
- Vision attempts
- Mate status

### Solution Fields
Backend returns:
- `fen`
- `mate_found`
- `mate_in`
- `moves_san`
- `moves_uci`

## Common Errors
### Invalid Position
- Message examples:
  - `Invalid FEN returned from Gemini`
  - `Invalid chess position detected`
- Retry with a clearer board image.

### No Forced Mate Found
- Not always an error.
- Means no forced mate in 1..3 was detected for current position.

### Engine and Service Failures
- Message example:
  - `Stockfish not found. Install Stockfish locally and set STOCKFISH_PATH to the executable path.`
- If backend is overloaded, retry after a short delay.

## Tips
### Better Solve Reliability
- Use clear board images with all squares visible.
- Verify side-to-move selector before solving.

### Interpreting Solve Results
- Low vision confidence suggests position may be misread.
- If result looks wrong, re-crop and retry.
