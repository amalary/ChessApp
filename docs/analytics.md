```json
{
  "title": "Analytics",
  "slug": "analytics",
  "category": "dashboard",
  "related_routes": ["/dashboard"],
  "related_features": ["accuracy tracking", "theme analysis", "first-move metrics", "history insights"],
  "intended_audience": "end_user",
  "last_updated": "AUTO_GENERATED"
}
```

# Analytics

## Overview
### Metrics Scope
Analytics is shown inside the `/dashboard` page and summarizes recent puzzle performance from locally stored solve submissions.

### Data Sources
- Data comes from puzzle submissions recorded in browser local storage.
- No server-side sync is currently documented in this code path.

<!-- REVIEW_NEEDED: Confirm whether analytics data should be persisted server-side in production. -->

## How It Works
### User Actions
1. Open `/dashboard`.
2. Click **Analytics** in the sidebar.
3. Expand sections to inspect details.

### System Behavior
- Theme accuracy is computed from recent solved submissions.
- Dashboard charts update when local submission history changes.
- Some sections are expandable/collapsible for readability.

### Edge Cases
- If you have little or no solve history, metrics can be sparse.
- Some sections are scaffolded placeholders.

## Step-by-Step Usage
### Open Analytics Section
- Navigate to `/dashboard`.
- Select **Analytics** in the left nav.

### Read Core Metrics
Start with:
- Accuracy by Theme
- Weakest theme indicator
- Associated puzzle list

### Expand Detailed Sections
Available detailed sections include:
- Solve Time vs Difficulty
- Puzzle Rating Progression
- First-Move Accuracy

## Expected Output
### Metric Cards
You should see cards and sections that reflect your recent solve activity.

### Thematic and Trend Views
You should see:
- Theme-level accuracy percentages
- Trend-style chart areas
- First-move quality summaries when enough data exists

## Common Errors
### Missing or Sparse Data
- Cause: not enough solved puzzles stored locally.
- Result: weak or limited trend signals.

### Inconsistent Metric Expectations
- Cause: analytics uses local stored submissions and app-specific scoring.
- Result: values may differ from external trackers.

## Tips
### Reading Trends
- Look at multi-solve patterns, not one puzzle.
- Focus on weakest theme and first-move accuracy together.

### Improving Decision Quality
- Use analytics after several solves.
- Re-check low-confidence solves before drawing conclusions.

## Planned or Partial Areas
- **Planned feature — not currently available:** fully implemented "Accuracy by Difficulty" section content.
- Some analytics subsections currently render scaffold text in the UI.
