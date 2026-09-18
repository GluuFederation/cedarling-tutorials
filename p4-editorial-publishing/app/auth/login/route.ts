import { NextResponse } from "next/server";
import { runtime } from "@/src/server/runtime.ts";
import { transactionCookie } from "@/src/server/session.ts";

export async function GET(request: Request) {
  const services = await runtime();
  try {
    const login = await services.sessions.beginLogin(
      new URL(request.url).searchParams.get("login_hint"),
    );
    const response = NextResponse.redirect(login.url);
    response.cookies.set(
      transactionCookie,
      login.raw,
      services.sessions.cookieOptions(120),
    );
    return response;
  } catch {
    return NextResponse.json(
      { error: "invalid_tutorial_identity" },
      { status: 400 },
    );
  }
}
