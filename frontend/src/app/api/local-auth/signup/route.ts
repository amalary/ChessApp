import { NextResponse } from "next/server";

const LOCAL_AUTH_SESSION_COOKIE = "chessapp_local_auth_session";
const LOCAL_AUTH_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

function backendBaseUrl(): string {
  const configured =
    process.env.BACKEND_URL ??
    process.env.NEXT_PUBLIC_BACKEND_URL ??
    "http://127.0.0.1:8010";
  return configured.replace(/\/+$/, "");
}

export async function POST(request: Request) {
  const body = await request.text();
  const target = `${backendBaseUrl()}/auth/signup`;

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });

    const text = await upstream.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { detail: text || "Unexpected upstream response." };
    }

    if (payload && typeof payload === "object") {
      const candidate = payload as {
        detail?: unknown;
        error?: { message?: unknown } | unknown;
      };
      if (
        (candidate.detail === undefined || candidate.detail === null) &&
        candidate.error &&
        typeof candidate.error === "object" &&
        typeof (candidate.error as { message?: unknown }).message === "string"
      ) {
        candidate.detail = (candidate.error as { message: string }).message;
      }
      payload = candidate;
    }

    let localSessionToken: string | null = null;
    if (upstream.ok && payload && typeof payload === "object") {
      const candidate = payload as { local_session_token?: unknown };
      if (
        typeof candidate.local_session_token === "string" &&
        candidate.local_session_token.trim()
      ) {
        localSessionToken = candidate.local_session_token.trim();
      }
    }

    const response = NextResponse.json(payload, { status: upstream.status });
    if (localSessionToken) {
      response.cookies.set({
        name: LOCAL_AUTH_SESSION_COOKIE,
        value: localSessionToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: LOCAL_AUTH_SESSION_MAX_AGE_SECONDS,
      });
    }
    return response;
  } catch (error: unknown) {
    console.error("Local auth signup proxy failed", error);
    return NextResponse.json(
      {
        detail: "Authentication service is unavailable. Please try again shortly.",
      },
      { status: 502 },
    );
  }
}
