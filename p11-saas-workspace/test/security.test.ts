import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  boundToken,
  decryptJson,
  encryptJson,
  tokenHash,
} from "../server/auth/crypto.ts";
import {
  expectedVersion,
  identifier,
  invitationToken,
  inviteRole,
  projectBody,
  projectName,
} from "../server/shared/validation.ts";

const environment = {
  P11_DATABASE_URL: "postgresql://p11:p11@127.0.0.1:5435/p11",
  P11_CLIENT_SECRET: "client-secret-with-at-least-32-characters",
  P11_SESSION_SECRET: "session-secret-with-at-least-32-characters",
};

describe("P11 security controls", () => {
  it("encrypts server-held token material and authenticates tampering", () => {
    const encrypted = encryptJson(
      { accessToken: "private-token" },
      environment.P11_SESSION_SECRET,
    );
    expect(encrypted).not.toContain("private-token");
    expect(
      decryptJson<{ accessToken: string }>(
        encrypted,
        environment.P11_SESSION_SECRET,
      ).accessToken,
    ).toBe("private-token");
    expect(() =>
      decryptJson(`${encrypted}x`, environment.P11_SESSION_SECRET),
    ).toThrow();
  });

  it("derives stable invitation retry tokens bound to their command", () => {
    const token = boundToken(environment.P11_SESSION_SECRET, "invite:one");
    expect(boundToken(environment.P11_SESSION_SECRET, "invite:one")).toBe(
      token,
    );
    expect(boundToken(environment.P11_SESSION_SECRET, "invite:two")).not.toBe(
      token,
    );
  });

  it("bounds identifiers, versions, roles, names, and bodies", () => {
    expect(identifier("project-a1", "project")).toBe("project-a1");
    expect(() => identifier("../aster", "project")).toThrow();
    expect(expectedVersion("1")).toBe(1);
    for (const value of [
      1,
      0,
      "0",
      "01",
      "+1",
      " 1",
      "1 ",
      "1e1",
      "1.0",
      "9007199254740992",
      undefined,
      null,
    ]) {
      expect(() => expectedVersion(value)).toThrow();
    }
    expect(inviteRole("viewer")).toBe("viewer");
    expect(() => inviteRole("admin")).toThrow();
    expect(invitationToken("p11-lena-invite-token")).toBe(
      "p11-lena-invite-token",
    );
    for (const token of [undefined, 1234, "short", "x".repeat(201)]) {
      expect(() => invitationToken(token)).toThrow("invalid_invitation_token");
    }
    expect(projectName(" Aster ")).toBe("Aster");
    expect(() => projectName("\u0000bad")).toThrow();
    expect(() => projectBody("x".repeat(16_385))).toThrow();
  });

  it("stores only the hash of the one-time invitation token", () => {
    const seed = readFileSync("fixtures/seed.sql", "utf8");
    expect(seed).toContain(tokenHash("p11-lena-invite-token"));
    expect(seed).not.toContain("'p11-lena-invite-token'");
    const migration = readFileSync("migrations/001_initial.sql", "utf8");
    expect(migration).toContain("token_hash text NOT NULL");
    expect(migration).toContain("PRIMARY KEY (principal_id, operation, key)");
    const integrity = readFileSync(
      "migrations/002_command_and_scope_integrity.sql",
      "utf8",
    );
    expect(integrity).toContain("request_hash text");
    expect(integrity).toContain("support_session_scope_fkey");
  });

  it("gives PostgreSQL only its required startup capabilities", () => {
    const compose = readFileSync("compose.yaml", "utf8");
    const postgres = compose.slice(
      compose.indexOf("  postgres:"),
      compose.indexOf("  identity-provider:"),
    );
    expect(postgres).toContain('cap_drop: ["ALL"]');
    expect(postgres).toContain(
      'cap_add: ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"]',
    );
  });
});
