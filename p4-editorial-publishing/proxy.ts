import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const canonicalOrigin = new URL(
    process.env.P4_BASE_URL ?? "http://p4.localhost:3004",
  ).origin;
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim();
  const requestOrigin = `${forwardedProtocol ?? request.nextUrl.protocol.replace(":", "")}://${request.headers.get("host") ?? request.nextUrl.host}`;
  if (request.nextUrl.pathname !== "/health") {
    if (requestOrigin !== canonicalOrigin) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return NextResponse.json(
          { error: "canonical_origin_required" },
          { status: 400 },
        );
      }
      if (request.headers.get("sec-fetch-dest") !== "empty") {
        return NextResponse.redirect(
          new URL(
            `${request.nextUrl.pathname}${request.nextUrl.search}`,
            canonicalOrigin,
          ),
          307,
        );
      }
    }
  }
  const nonce = randomBytes(18).toString("base64");
  const requestId = randomBytes(12).toString("base64url");
  const development = process.env.NODE_ENV === "development";
  const issuerOrigin = new URL(
    process.env.P4_ISSUER ?? "http://idp.localhost:4000",
  ).origin;
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    `form-action 'self' ${issuerOrigin}`,
  ].join("; ");
  const forwarded = new Headers(request.headers);
  forwarded.set("x-nonce", nonce);
  forwarded.set("x-request-id", requestId);
  forwarded.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.headers.set("X-Request-ID", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
