```json
{
  "title": "Settings",
  "slug": "settings",
  "category": "dashboard",
  "related_routes": ["/dashboard"],
  "related_features": ["theme mode", "accent colors", "gradient preferences", "user-scoped settings"],
  "intended_audience": "end_user",
  "last_updated": "AUTO_GENERATED"
}
```

# Settings

## Overview
### Settings Scope
Settings is available inside `/dashboard` and currently focuses on theme and UI customization.

### Persistence Scope
Theme/UI choices are saved in browser storage and scoped to the active user identity when available.

## How It Works
### User Actions
1. Open `/dashboard`.
2. Select **Settings** in the sidebar.
3. Change theme mode, colors, or gradient style.
4. Save theme.

### System Behavior
- Theme mode toggles between Light and Dark.
- You can switch between Solid and Gradient backgrounds.
- Gradient direction and color pickers update preview in real time.
- Save action persists current theme settings to local storage.

### Edge Cases
- Unsaved changes can be lost if you navigate away.
- Settings can differ across browsers/devices because storage is local.

## Step-by-Step Usage
### Open Settings Section
- Go to `/dashboard`.
- Click **Settings**.

### Update Theme Preferences
- Set Theme mode: Light or Dark.
- Set Background style: Solid or Gradient.
- If Gradient is enabled, choose gradient direction.
- Adjust colors with color wheel or quick swatches.

### Save and Verify Changes
- Click **Save theme**.
- Look for the **Saved** indicator.
- Confirm visual updates on dashboard surfaces.

## Expected Output
### Visual Changes
- Background and panel colors update immediately.
- Gradient preview updates when gradient mode is enabled.

### Persisted Preferences
- Theme/UI preferences should remain after page reload in the same browser.

## Common Errors
### Unsaved Changes
- Symptom: styles revert after refresh.
- Fix: click **Save theme** before leaving the page.

### Unexpected Theme State
- Symptom: different colors than expected.
- Fix:
  1. Click **Reset default**.
  2. Re-apply colors.
  3. Save again.

## Tips
### Theme Consistency Tips
- Save after each major color change.
- Use swatches for repeatable palettes.

### Multi-Session Tips
- Expect differences across devices/browsers unless sync is implemented.

## Planned or Partial Areas
- **Planned feature — not currently available:** fully wired account/profile updates.
- **Planned feature — not currently available:** fully wired password update action.
- **Planned feature — not currently available:** fully wired delete-account action.

<!-- REVIEW_NEEDED: Confirm whether account/profile controls should be hidden until backend integration exists. -->
