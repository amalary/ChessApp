import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { buildAuthSessionUserPayload } from "@/lib/auth-session-user";

export async function GET() {
  const session = await auth0.getSession();

  if (!session?.user) {
    return NextResponse.json(
      { error: "not_authenticated" },
      { status: 401 }
    );
  }

  const user = session.user as Record<string, unknown>;

  return NextResponse.json(buildAuthSessionUserPayload(user));
}
