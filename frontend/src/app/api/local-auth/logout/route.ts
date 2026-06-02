import { NextResponse } from "next/server";

const LOCAL_AUTH_SESSION_COOKIE = "chessapp_local_auth_session";

export function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: LOCAL_AUTH_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
