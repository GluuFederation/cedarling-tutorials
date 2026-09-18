import { type NextRequest, NextResponse } from "next/server";
import { runtime } from "@/src/server/runtime.ts";
import { sessionCookie } from "@/src/server/session.ts";

export async function POST(request: NextRequest) {
  const services = await runtime();
  try {
    await services.sessions.requireMutation(await request.formData());
  } catch {
    return NextResponse.json(
      { error: "request_integrity_required" },
      { status: 403 },
    );
  }
  services.sessions.logout(request.cookies.get(sessionCookie)?.value);
  const response = NextResponse.redirect(
    new URL("/", services.config.baseUrl),
    303,
  );
  response.cookies.set(sessionCookie, "", services.sessions.cookieOptions(0));
  return response;
}
