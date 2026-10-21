const connectionCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);

// Only expose selected transport facts, never raw provider errors or config.
export function discoveryFailure(issuer: string, error: unknown) {
  const connections: { code: string; port?: number }[] = [];
  function visit(value: unknown, depth = 0): void {
    if (!value || typeof value !== "object" || depth > 5) return;
    const entry = value as Record<string, unknown>;
    if (typeof entry.code === "string" && connectionCodes.has(entry.code)) {
      const port =
        typeof entry.port === "number" &&
        Number.isInteger(entry.port) &&
        entry.port > 0 &&
        entry.port <= 65_535
          ? entry.port
          : undefined;
      connections.push({
        code: entry.code,
        ...(port === undefined ? {} : { port }),
      });
    }
    visit(entry.cause, depth + 1);
    if (Array.isArray(entry.errors)) {
      for (const nested of entry.errors.slice(0, 8)) visit(nested, depth + 1);
    }
  }
  visit(error);
  return {
    event: "startup.failed",
    application: "P8 server",
    stage: "oidc.discovery",
    issuerOrigin: new URL(issuer).origin,
    connections,
    message:
      "Check P8_ISSUER and the IdP configuration, then restart. Docker expects http://localhost:18008; do not delete data or credentials to retry.",
  };
}

export function formatDiscoveryFailure(issuer: string, error: unknown): string {
  const failure = discoveryFailure(issuer, error);
  const connections = failure.connections.map(
    ({ code, port }) => `${code}${port === undefined ? "" : `:${port}`}`,
  );
  return [
    "P8 server",
    "STARTUP FAILED",
    failure.stage,
    failure.issuerOrigin,
    ...(connections.length ? [connections.join(", ")] : []),
    failure.message,
  ].join(" | ");
}
