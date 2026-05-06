```json
{
  "title": "Uploading Puzzles",
  "slug": "uploading-puzzles",
  "category": "core-feature",
  "related_routes": ["/solve"],
  "related_features": ["image upload", "upload validation", "side-to-move selection"],
  "intended_audience": "end_user",
  "last_updated": "AUTO_GENERATED"
}
```

# Uploading Puzzles

## Overview
### Supported Inputs
- File formats accepted by backend validation:
  - `image/jpeg`
  - `image/png`
  - `image/webp`
- Maximum upload size: 10 MB.

### Preconditions
- You are on the solve page (`/solve-test`).
- You have a puzzle image file ready.

## How It Works
### User Actions
1. Click **Upload Image**.
2. Pick a puzzle image.
3. Optionally toggle side-to-move using the crown button.
4. Continue to first-move selection and solving.

### System Behavior
- Frontend file picker allows `image/*`.
- Backend validates file type and size before running solve.
- Invalid uploads are rejected before board extraction.

### Edge Cases
- A file might be selectable in browser but still rejected by backend type/size checks.
- Empty or oversized image payloads are rejected.

## Step-by-Step Usage
### Select Puzzle Image
- Use **Upload Image** on `/solve-test`.
- After selection, the preview appears in the puzzle frame.

### Set Side to Move
- Use the crown icon in the top-left:
  - White outline = white to move
  - Filled dark crown = black to move

### Submit Upload
- Upload alone does not send solve.
- You must select first move and press **Solve** to submit the request.

## Expected Output
### Upload Acceptance
- The selected image appears in preview.
- Board overlay becomes available for first-move selection.

### Validation Feedback
- Invalid files return user-visible error text.
- Common backend validation error text: `Invalid file type or size.`

## Common Errors
### Unsupported File Input
- Cause: File MIME type is not JPEG/PNG/WEBP.
- What to do:
  1. Re-export image as PNG or JPEG.
  2. Re-upload.

### Upload Validation Failures
- Cause: file is empty or larger than 10 MB.
- What to do:
  1. Reduce image size.
  2. Retry with a compressed image.

## Tips
### Image Quality Tips
- Crop tightly around the board.
- Use clear, front-facing board images.
- Avoid heavy blur and reflections.

### Input Preparation Tips
- Make sure all 64 squares are visible.
- Avoid overlapping annotations or stickers on pieces.
