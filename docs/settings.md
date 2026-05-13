```json
{
  "title": "Settings",
  "slug": "settings",
  "category": "dashboard",
  "related_routes": ["/dashboard"],
  "related_features": ["theme mode", "accent colors", "gradient preferences", "user-scoped settings"],
  "intended_audience": "end_user",
  "last_updated": "2026-05-12"
}
```

# Settings

## Overview
### Settings Scope
Settings lives in `/dashboard` and currently focuses on theme and UI customization.

### Persistence Scope
Theme/UI choices are stored in browser storage and scoped to active user context when available.

## How It Works
### User Actions
1. Open `/dashboard`.
2. Select **Settings**.
3. Change theme mode, colors, or gradient style.
4. Save theme.

### System Behavior
- Theme mode toggles between Light and Dark.
- Background can be Solid or Gradient.
- Gradient direction and colors update preview immediately.
- Save persists settings to local storage.

### Edge Cases
- Unsaved changes are lost if you navigate away.
- Settings can vary across browsers/devices.

## Step-by-Step Usage
### Open Settings Section
- Go to `/dashboard`.
- Click **Settings**.

### Update Theme Preferences
- Set theme mode.
- Set background style.
- If gradient is enabled, set direction and colors.

### Save and Verify
- Click **Save theme**.
- Confirm **Saved** indicator.
- Reload and confirm settings persist.

## Expected Output
### Visual Changes
- Background and panel colors update immediately.
- Gradient preview changes in real time.

### Persisted Preferences
- Theme choices remain after reload in same browser.

## Common Errors
### Unsaved Changes
- Symptom: styles revert on refresh.
- Fix: click **Save theme** before leaving.

### Unexpected Theme State
- Symptom: colors differ from expected.
- Fix:
  1. Click **Reset default**.
  2. Re-apply colors.
  3. Save again.

## Tips
### Theme Consistency
- Save after each major color change.
- Use swatches for repeatable palettes.

### Multi-Session
- Expect differences across devices/browsers unless sync is later added.

## Planned or Partial Areas
- **Planned feature - not currently available:** full account/profile backend persistence.
- **Planned feature - not currently available:** full password update action.
- **Planned feature - not currently available:** full delete-account action.
