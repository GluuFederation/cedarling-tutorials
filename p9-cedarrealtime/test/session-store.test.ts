import { describe, expect, it, vi } from "vitest";
import { createHarness } from "./harness.ts";

describe("application sessions and connection tickets", () => {
  it("stores opaque sessions and consumes each ticket exactly once", () => {
    const harness = createHarness();
    try {
      const created = harness.session("user-mei");
      const session = harness.sessions.getSession(
        created.rawId,
        harness.config,
      );
      expect(session?.user.id).toBe("user-mei");
      expect(
        JSON.stringify(
          harness.database.connection.prepare("SELECT * FROM sessions").get(),
        ),
      ).not.toContain("test-access-token");
      const ticket = harness.sessions.createTicket(session?.idHash ?? "");
      expect(
        harness.sessions.consumeTicket(ticket.ticket, harness.config)?.user.id,
      ).toBe("user-mei");
      expect(
        harness.sessions.consumeTicket(ticket.ticket, harness.config),
      ).toBeUndefined();
    } finally {
      harness.close();
    }
  });

  it("publishes revocation and immediately invalidates the current session", () => {
    const harness = createHarness();
    try {
      const created = harness.session("user-yuki");
      const listener = vi.fn();
      harness.sessions.onRevoked(listener);
      harness.sessions.revokeSession(created.rawId);
      expect(listener).toHaveBeenCalledOnce();
      expect(
        harness.sessions.getSession(created.rawId, harness.config),
      ).toBeUndefined();
    } finally {
      harness.close();
    }
  });

  it("rejects expired tickets before socket activation", () => {
    const harness = createHarness();
    try {
      const created = harness.session("user-kwame");
      const session = harness.sessions.getSession(
        created.rawId,
        harness.config,
      );
      const ticket = harness.sessions.createTicket(session?.idHash ?? "");
      harness.database.connection
        .prepare("UPDATE connection_tickets SET expires_at = 0")
        .run();
      expect(
        harness.sessions.consumeTicket(ticket.ticket, harness.config),
      ).toBeUndefined();
    } finally {
      harness.close();
    }
  });
});
