```json
{
  "title": "FAQ",
  "slug": "faq",
  "category": "support",
  "related_routes": ["/solve", "/assistant", "/dashboard", "/agent"],
  "related_features": ["frequently asked questions", "feature clarification", "usage guidance"],
  "intended_audience": "end_user",
  "last_updated": "AUTO_GENERATED"
}
```

# FAQ

## Overview
### FAQ Scope
Quick answers about solve flow, analytics, settings, and assistant behavior.

### Audience
End users who want short operational answers.

## How It Works
### How to Use This Page
- Find your area (Account, Solve, Analytics, Assistant, Troubleshooting).
- Apply the shortest recommended fix first.

### What This FAQ Covers
- Current behavior visible in the codebase.
- Planned features are clearly labeled.

## Account and Access
### Q: Do I need to sign in to use the app?
A: Solve and dashboard pages are available in current app routes. Assistant API calls require a valid Auth0 access token.

### Q: Why do I see a missing token message in Agent chat?
A: The assistant call needs Auth0 access token retrieval. Sign in again and retry.

## Upload and Solve
### Q: Which image formats are supported?
A: JPEG, PNG, and WEBP are supported by backend validation.

### Q: Is there a file size limit?
A: Yes. Maximum upload size is 10 MB.

### Q: Why is Solve button disabled?
A: You must upload an image and select your first move (source + destination squares).

### Q: What does "No forced mate (1-3)" mean?
A: The solver did not find a forced mate within mate-in-1 to mate-in-3.

### Q: Why did my puzzle fail with invalid position/FEN?
A: Board extraction likely failed due to image quality or board ambiguity. Retry with a clearer crop.

## Analytics and Settings
### Q: Where does analytics data come from?
A: From solved puzzle submissions stored in browser local storage.

### Q: Why are some analytics sections minimal?
A: Some analytics subsections are scaffolded and not fully implemented yet.

### Q: Are Settings account actions fully active?
A: Planned feature - not currently available for full backend persistence of profile/password/delete actions.

### Q: Do theme settings persist?
A: Yes, theme/UI preferences persist locally when saved.

## Assistant
### Q: What can the assistant do today?
A: It can explain puzzle lines, provide hints, identify likely tactical themes, and answer basic app-navigation prompts.

### Q: Can assistant answers include unsafe or secret data?
A: No. Guardrails block prompt-injection patterns and secret-like output.

### Q: Is assistant documentation retrieval (RAG) active?
A: Planned feature - not currently available.

### Q: Can the assistant analyze any move I type?
A: It validates legality against current position context when available and refuses illegal move lines.

## Troubleshooting and Support
### Q: Upload fails with "Invalid file type or size." What should I do?
A: Convert image to PNG/JPEG/WEBP and keep file under 10 MB.

### Q: Solve appears to take too long. What should I do?
A: Wait briefly and retry. Backend can be busy or rate limited.

### Q: When should I escalate to maintainers?
A: Escalate after repeated reproducible failures with clear error text and retry steps documented.

<!-- REVIEW_NEEDED: Confirm final production auth and route-access policy for end-user messaging. -->
