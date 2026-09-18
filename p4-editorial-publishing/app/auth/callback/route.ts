import { type NextRequest, NextResponse } from "next/server";
import { runtime } from "@/src/server/runtime.ts";
import { sessionCookie, transactionCookie } from "@/src/server/session.ts";

export async function GET(request: NextRequest) {
  const services = await runtime();
  const transaction = request.cookies.get(transactionCookie)?.value;
  if (!transaction)
    return NextResponse.json(
      { error: "invalid_login_transaction" },
      { status: 400 },
    );
  try {
    const callback = new URL(request.url);
    const trustedCallback = new URL(
      `/auth/callback${callback.search}`,
      services.config.baseUrl,
    );
    const session = await services.sessions.finishLogin(
      trustedCallback,
      transaction,
    );
    const response = NextResponse.redirect(
      new URL("/", services.config.baseUrl),
    );
    response.cookies.set(
      sessionCookie,
      session,
      services.sessions.cookieOptions(),
    );
    response.cookies.set(
      transactionCookie,
      "",
      services.sessions.cookieOptions(0),
    );
    return response;
  } catch (error) {
    console.error("P4 login callback rejected", {
      error: error instanceof Error ? error.message : "unknown failure",
    });
    const response = NextResponse.json(
      { error: "login_callback_rejected" },
      { status: 400 },
    );
    response.cookies.set(
      transactionCookie,
      "",
      services.sessions.cookieOptions(0),
    );
    return response;
  }
}
