import { NextResponse } from "next/server";

function backendBaseUrl(): string {
  const configured =
    process.env.BACKEND_URL ??
    process.env.NEXT_PUBLIC_BACKEND_URL ??
    "http://127.0.0.1:8010";
  return configured.replace(/\/+$/, "");
}

export async function POST(request: Request) {
  const body = await request.text();
  const target = `${backendBaseUrl()}/auth/login`;

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

    return NextResponse.json(payload, { status: upstream.status });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json(
      {
        detail: `Cannot reach backend auth service at ${target}. ${reason}`,
      },
      { status: 502 },
    );
  }
}
