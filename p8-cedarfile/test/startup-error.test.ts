import { describe, expect, it } from "vitest";
import {
  discoveryFailure,
  formatDiscoveryFailure,
} from "../src/server/startup-error.ts";

describe("OIDC startup diagnostics", () => {
  it("reports a refused port without leaking raw errors or issuer credentials", () => {
    const error = new TypeError("secret-token", {
      cause: Object.assign(new Error("secret-client"), {
        code: "ECONNREFUSED",
        port: 4000,
      }),
    });
    const record = discoveryFailure(
      "http://user:secret-password@localhost:18008/?token=secret-query",
      error,
    );
    expect(record.issuerOrigin).toBe("http://localhost:18008");
    expect(record.connections).toEqual([{ code: "ECONNREFUSED", port: 4000 }]);
    expect(JSON.stringify(record)).not.toContain("secret");
    const line = formatDiscoveryFailure(
      "http://user:secret-password@localhost:18008/?token=secret-query",
      error,
    );
    expect(line).toContain(
      "P8 server | STARTUP FAILED | oidc.discovery | http://localhost:18008 | ECONNREFUSED:4000 | Check P8_ISSUER",
    );
    expect(line).not.toMatch(/secret|[\r\n]/);
  });

  it("handles aggregate transport failures and unknown provider errors safely", () => {
    const error = new TypeError("fetch failed", {
      cause: new AggregateError([
        { code: "ETIMEDOUT", port: 18008 },
        { code: "ENETUNREACH", port: 18008 },
        { code: "secret-error", port: "secret" },
      ]),
    });
    expect(
      discoveryFailure("http://localhost:18008", error).connections,
    ).toEqual([
      { code: "ETIMEDOUT", port: 18008 },
      { code: "ENETUNREACH", port: 18008 },
    ]);
    expect(
      discoveryFailure("http://localhost:18008", new Error("invalid metadata")),
    ).toMatchObject({ stage: "oidc.discovery", connections: [] });
  });
});
