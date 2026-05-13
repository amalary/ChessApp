```json
{
  "title": "FAQ",
  "slug": "faq",
  "category": "support",
  "related_routes": ["/solve-test", "/assistant", "/dashboard", "/agent", "/login-test"],
  "related_features": ["frequently asked questions", "feature clarification", "usage guidance"],
  "intended_audience": "end_user",
  "last_updated": "2026-05-12"
}
```

# FAQ

## Overview
### FAQ Scope
Quick answers about auth, solving, analytics, settings, and assistant behavior.

### Audience
End users who want short operational answers.

## Account and Access
### Q: Do I need to sign in to use the app?
A: For local flow, use `/login-test` to sign up/login before solving and dashboard use. Assistant calls still require an Auth0 access token.

### Q: Why do I see a missing token message in Agent chat?
A: Agent calls backend `/assistant` with Auth0 bearer token. Sign in via Auth0 and retry.

### Q: What is local auth used for?
A: Local auth identifies your user for local account sessions and allows puzzle submission persistence through `X-Local-Auth-User-Id`.

## Upload and Solve
### Q: Which image formats are supported?
A: JPEG, PNG, and WEBP.

### Q: Is there a file size limit?
A: Yes, max upload size is 10 MB.

### Q: Why is Solve button disabled?
A: You must upload an image and select first move squares before solving.

### Q: What does `No forced mate (1-3)` mean?
A: No forced mate was found within mate in 1..3.

### Q: Why did my puzzle fail with invalid position/FEN?
A: Board extraction likely failed due to image quality or board ambiguity.

## Analytics and Settings
### Q: Where does analytics data come from?
A: From stored puzzle submissions in browser storage; local-auth users can also pull server-side submissions.

### Q: Do theme settings persist?
A: Yes. Theme settings persist in browser storage.

### Q: Are account/profile/password settings fully wired?
A: Dashboard settings currently focus on theme/UI preferences, not full account management.

## Assistant
### Q: What can the assistant do today?
A: Explain puzzle lines, provide hints, identify tactical themes, and answer basic app navigation prompts.

### Q: Is retrieval-based app documentation Q&A active?
A: Not yet. Assistant app-navigation support is currently keyword/logic based.

### Q: Can assistant answers include unsafe or secret data?
A: Guardrails are designed to block unsafe and secret-like outputs.

## Troubleshooting and Support
### Q: Upload fails with `Invalid file type or size.` What should I do?
A: Convert image to PNG/JPEG/WEBP and keep it under 10 MB.

### Q: When should I escalate to maintainers?
A: Escalate after reproducible failures with exact error text and retry steps documented.
