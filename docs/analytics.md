```json
{
  "title": "Analytics",
  "slug": "analytics",
  "category": "dashboard",
  "related_routes": ["/dashboard"],
  "related_features": ["accuracy tracking", "theme analysis", "first-move metrics", "history insights"],
  "intended_audience": "end_user",
  "last_updated": "2026-05-12"
}
```

# Analytics

## Overview
### Metrics Scope
Analytics appears in `/dashboard` and summarizes puzzle performance trends.

### Data Sources
- Browser-local puzzle submissions and derived stats.
- For local-auth users, submissions can also be loaded from backend `/puzzles/submissions`.

## How It Works
### User Actions
1. Open `/dashboard`.
2. Click **Analytics**.
3. Expand sections for details.

### System Behavior
- Theme accuracy is computed from recent solves.
- Trend views refresh when submission history changes.
- Some sections show placeholder content when data is limited.

### Edge Cases
- Sparse history leads to sparse metrics.
- Low-confidence solves can skew trend interpretation.

## Step-by-Step Usage
### Open Analytics
- Navigate to `/dashboard`.
- Select **Analytics**.

### Read Core Metrics
Start with:
- Accuracy by Theme
- Weakest theme indicator
- Associated puzzle list

### Expand Detailed Sections
Detailed sections include:
- Solve Time vs Difficulty
- Puzzle Rating Progression
- First-Move Accuracy

## Expected Output
### Metric Cards
Cards should reflect your recent solve activity.

### Trend Views
You should see:
- Theme-level accuracy percentages
- Progression/trend visuals
- First-move quality summaries when enough data exists

## Common Errors
### Missing or Sparse Data
- Cause: not enough solved puzzles.
- Result: weak or limited trend signals.

### Inconsistent Expectations
- Cause: metrics are app-specific and based on stored submissions.
- Result: values can differ from external trackers.

## Tips
### Reading Trends
- Use multi-puzzle patterns, not single-puzzle swings.
- Pair weakest-theme view with first-move accuracy.

### Improving Decision Quality
- Review analytics after multiple solves.
- Re-check low-confidence solves before acting on trends.

## Planned or Partial Areas
- **Planned feature - not currently available:** fully implemented `Accuracy by Difficulty` content.
- Some analytics subsections still render scaffold text.
