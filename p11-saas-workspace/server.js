import { randomBytes } from "node:crypto";
import express from "express";

const buildPath = "./build/server/index.js";
const development = process.env.NODE_ENV === "development";
const host = process.env.P11_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.P11_PORT || "3011", 10);
const baseUrl = process.env.P11_BASE_URL || `http://${host}:${port}`;
const requestBytes = 24_576;
const requestsPerMinute = 120;
const rates = new Map();
const app = express();

app.disable("x-powered-by");
app.set("trust proxy", false);
app.use((request, response, next) => {
  const nonce = randomBytes(18).toString("base64url");
  response.locals.nonce = nonce;
  response.locals.requestId = randomBytes(12).toString("base64url");
  response.setHeader("X-Request-ID", response.locals.requestId);
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
  );
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );

  const now = Date.now();
  const key = request.socket.remoteAddress || "unknown";
  const current = rates.get(key);
  if (!current || current.startedAt + 60_000 <= now) {
    rates.set(key, { startedAt: now, count: 1 });
  } else if (++current.count > requestsPerMinute) {
    response.status(429).send("Too many requests");
    return;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const length = Number(request.headers["content-length"]);
    if (
      request.headers["transfer-encoding"] ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > requestBytes
    ) {
      response.status(413).send("Request body is too large or unbounded");
      return;
    }
  }
  next();
});

/** @typedef {{ app: import("express").RequestHandler, closeRuntime?: () => Promise<void> }} ApplicationModule */
/** @type {ApplicationModule} */
let applicationModule;
if (development) {
  const vite = await import("vite").then((module) =>
    module.createServer({ server: { middlewareMode: true } }),
  );
  applicationModule = /** @type {ApplicationModule} */ (
    await vite.ssrLoadModule("./server/app.ts")
  );
  app.use(vite.middlewares);
  app.use(async (request, response, next) => {
    try {
      applicationModule = /** @type {ApplicationModule} */ (
        await vite.ssrLoadModule("./server/app.ts")
      );
      return await applicationModule.app(request, response, next);
    } catch (error) {
      if (error instanceof Error) vite.ssrFixStacktrace(error);
      next(error);
    }
  });
} else {
  app.use(
    "/assets",
    express.static("build/client/assets", { immutable: true, maxAge: "1y" }),
  );
  app.use(express.static("build/client", { index: false, maxAge: "1h" }));
  applicationModule = /** @type {ApplicationModule} */ (
    await import(buildPath)
  );
  app.use(applicationModule.app);
}

const server = app.listen(port, host, () => {
  console.info("P11 authorization: FAKE ALLOW; Cedarling is not called.");
  console.info(`P11 CedarWorkspace listening at ${baseUrl}`);
});

let stopping = false;
/** @param {string} signal */
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.info(`Received ${signal}; stopping P11 CedarWorkspace`);
  server.close(async (error) => {
    try {
      await applicationModule?.closeRuntime?.();
    } finally {
      process.exitCode = error ? 1 : 0;
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
