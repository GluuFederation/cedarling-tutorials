import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseCookie, stringifySetCookie } from "cookie";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { accounts } from "../shared/protocol.ts";
import type { Config } from "./config.ts";
import type { Session, Store } from "./database.ts";
import type { Oidc } from "./oidc.ts";
import {
  AppError,
  decrypt,
  encrypt,
  hashToken,
  randomToken,
  safeToken,
  sessionExpired,
} from "./security.ts";
import {
  type AuthorizationAdapter,
  CapabilityGateway,
  MarketplaceService,
} from "./service.ts";

function setHeaders(app: express.Express) {
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.set({
      "x-request-id": randomUUID(),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    next();
  });
  app.use(express.json({ limit: "16kb", strict: true }));
}
function errors(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
) {
  const parserStatus =
    error && typeof error === "object" && "status" in error
      ? error.status
      : undefined;
  const safe =
    error instanceof AppError
      ? error
      : new AppError(
          parserStatus === 413 ? 413 : parserStatus === 400 ? 400 : 503,
          parserStatus === 413
            ? "BODY_TOO_LARGE"
            : parserStatus === 400
              ? "INVALID_JSON"
              : "DEPENDENCY_FAILURE",
          "Request failed.",
        );
  if (safe.status === 401)
    response.setHeader("Set-Cookie", cookie("p15_session", "", "/", 0));
  response.status(safe.status).json({
    error: { code: safe.code },
    requestId: response.getHeader("x-request-id"),
  });
}
const cookie = (name: string, value: string, path: string, maxAge: number) =>
  stringifySetCookie({
    name,
    value,
    path,
    maxAge,
    httpOnly: true,
    sameSite: "lax",
  });
function assertMutation(request: Request, session: Session, config: Config) {
  const csrf = request.headers["x-csrf-token"];
  const site = request.headers["sec-fetch-site"];
  if (
    request.headers.origin !== config.baseUrl ||
    (site !== undefined && site !== "same-origin" && site !== "none") ||
    typeof csrf !== "string" ||
    !safeToken(csrf, session.csrf)
  )
    throw new AppError(
      403,
      "REQUEST_REJECTED",
      "Request integrity check failed.",
    );
}

export function createApp(
  config: Config,
  store: Store,
  key: Buffer,
  oidc: Oidc,
  adapter?: AuthorizationAdapter,
  decisionLog?: (line: string) => void,
) {
  const app = express();
  setHeaders(app);
  const service = new MarketplaceService(
    store,
    new CapabilityGateway(adapter, decisionLog),
  );
  function session(request: Request) {
    const raw = parseCookie(request.headers.cookie ?? "").p15_session;
    const value =
      raw && /^[a-f0-9]{64}$/.test(raw)
        ? store.session(hashToken(raw), Date.now())
        : undefined;
    if (!value) throw sessionExpired();
    try {
      decrypt(value.encryptedTokens, key);
    } catch {
      store.deleteSession(value.hash);
      throw sessionExpired();
    }
    return value;
  }
  const send = (response: Response, value: object) =>
    response.json({
      ...value,
      requestId: response.getHeader("x-request-id"),
    });
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/auth/login", async (request, response) => {
    const hint = request.query.login_hint;
    if (
      typeof hint !== "string" ||
      !accounts.some((actor) => actor.id === hint)
    )
      throw new AppError(
        400,
        "INVALID_IDENTITY",
        "Choose a tutorial identity.",
      );
    const raw = randomToken();
    const transaction = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(),
    };
    store.saveLogin(hashToken(raw), transaction, Date.now());
    response.setHeader(
      "Set-Cookie",
      cookie("p15_login", raw, "/auth/callback", 300),
    );
    response.redirect((await oidc.authorization(transaction, hint)).toString());
  });
  app.get("/auth/callback", async (request, response) => {
    const cookies = parseCookie(request.headers.cookie ?? "");
    response.setHeader(
      "Set-Cookie",
      cookie("p15_login", "", "/auth/callback", 0),
    );
    const transaction = cookies.p15_login
      ? store.login(hashToken(cookies.p15_login), Date.now())
      : undefined;
    if (!transaction)
      throw new AppError(400, "LOGIN_REJECTED", "Login transaction expired.");
    try {
      const identity = await oidc.exchange(
        new URL(request.originalUrl, config.baseUrl),
        transaction,
      );
      const actor = store.actor(identity.subject);
      if (cookies.p15_session)
        store.deleteSession(hashToken(cookies.p15_session));
      const id = randomToken();
      store.createSession(
        {
          hash: hashToken(id),
          actorId: actor.id,
          csrf: randomToken(),
          encryptedTokens: encrypt(identity.tokens, key),
          expiresAt: identity.expiresAt,
        },
        Date.now(),
      );
      response.appendHeader(
        "Set-Cookie",
        cookie(
          "p15_session",
          id,
          "/",
          Math.max(0, Math.floor((identity.expiresAt - Date.now()) / 1000)),
        ),
      );
      response.redirect("/");
    } catch {
      if (cookies.p15_session)
        store.deleteSession(hashToken(cookies.p15_session));
      response.appendHeader("Set-Cookie", cookie("p15_session", "", "/", 0));
      throw new AppError(400, "LOGIN_REJECTED", "Login rejected.");
    }
  });
  app.get("/api/session", (request, response) => {
    const value = session(request);
    const actor = store.actor(value.actorId);
    response.json({
      user: { id: actor.id, name: actor.name, role: actor.role },
      csrfToken: value.csrf,
      expiresAt: value.expiresAt,
    });
  });
  app.post("/auth/logout", (request, response) => {
    const value = session(request);
    assertMutation(request, value, config);
    store.deleteSession(value.hash);
    response.setHeader("Set-Cookie", cookie("p15_session", "", "/", 0));
    response.status(204).end();
  });
  app.use("/api", (request, _response, next) => {
    if (request.method === "POST" && !request.is("application/json"))
      throw new AppError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Use application/json.",
      );
    next();
  });
  const requestId = (response: Response) =>
    String(response.getHeader("x-request-id"));
  app.get("/api/catalog", (request, response) =>
    send(response, service.catalog(session(request), requestId(response))),
  );
  app.get("/api/orders", (request, response) =>
    send(response, service.orders(session(request), requestId(response))),
  );
  app.post("/api/orders", (request, response) => {
    const value = session(request);
    assertMutation(request, value, config);
    send(
      response,
      service.createOrder(value, request.body, requestId(response)),
    );
  });
  app.get("/api/refunds", (request, response) =>
    send(response, service.refunds(session(request), requestId(response))),
  );
  app.get("/api/refunds/:caseId", (request, response) =>
    send(
      response,
      service.view(
        session(request),
        request.params.caseId,
        request.query.section,
        requestId(response),
      ),
    ),
  );
  app.post("/api/refunds/:caseId/request", (request, response) => {
    const value = session(request);
    assertMutation(request, value, config);
    send(
      response,
      service.requestRefund(
        value,
        request.params.caseId,
        request.body,
        requestId(response),
      ),
    );
  });
  app.post("/api/refunds/:caseId/approval", (request, response) => {
    const value = session(request);
    assertMutation(request, value, config);
    send(
      response,
      service.approve(
        value,
        request.params.caseId,
        request.body,
        requestId(response),
      ),
    );
  });
  app.post("/api/refunds/:caseId/fraud-review", (request, response) => {
    const value = session(request);
    assertMutation(request, value, config);
    send(
      response,
      service.review(
        value,
        request.params.caseId,
        request.body,
        requestId(response),
      ),
    );
  });
  app.use(
    express.static(resolve("dist/web"), {
      index: "index.html",
      dotfiles: "deny",
    }),
  );
  app.use((_request, _response) => {
    throw new AppError(404, "NOT_FOUND", "Not found.");
  });
  app.use(errors);
  return app;
}
