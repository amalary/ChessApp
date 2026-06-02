import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

function normalizeLogoutReturnTo(rawValue: string | null, origin: string): string {
  const fallback = new URL("/login-test", origin);

  if (!rawValue) {
    return fallback.toString();
  }

  try {
    // Allow absolute URLs only if they stay on the same origin.
    const candidate = new URL(rawValue, origin);
    if (candidate.origin !== fallback.origin) {
      return fallback.toString();
    }
    return candidate.toString();
  } catch {
    return fallback.toString();
  }
}

export async function GET(request: Request) {
  const sourceUrl = new URL(request.url);
  const session = await auth0.getSession();
  const returnTo = normalizeLogoutReturnTo(
    sourceUrl.searchParams.get("returnTo"),
    sourceUrl.origin,
  );

  if (!session?.user) {
    return NextResponse.redirect(returnTo, 307);
  }

  const targetUrl = new URL("/auth/logout", sourceUrl);
  targetUrl.search = sourceUrl.search;
  targetUrl.searchParams.set("returnTo", returnTo);

  return NextResponse.redirect(targetUrl, 307);
}
