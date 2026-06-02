import { NextResponse } from "next/server";

export function GET(request: Request) {
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL("/login-test", sourceUrl);
  const requestedMode = sourceUrl.searchParams.get("mode");
  const screenHint = sourceUrl.searchParams.get("screen_hint");
  const returnTo = sourceUrl.searchParams.get("returnTo");

  const mode =
    requestedMode === "signup" || screenHint === "signup" ? "signup" : "login";
  targetUrl.searchParams.set("mode", mode);
  if (returnTo) {
    targetUrl.searchParams.set("returnTo", returnTo);
  }

  return NextResponse.redirect(targetUrl, 307);
}
