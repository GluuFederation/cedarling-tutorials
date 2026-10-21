// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/web/App.tsx";
import {
  realtimeEvents,
  type Ack,
  type PublishInput,
  type PublishResult,
} from "../src/shared/protocol.ts";

const socketFactory = vi.hoisted(() => vi.fn());
vi.mock("socket.io-client", () => ({ io: socketFactory }));

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("CedarRealtime shell", () => {
  it("sends on Enter once, preserves a failed draft, and allows Shift+Enter and composition", async () => {
    const room = {
      id: "room-a-general",
      tenantId: "tenant-a",
      name: "general",
      version: 1,
    };
    const outcome: PublishResult["outcome"] = {
      requestId: "req-test",
      capability: "message.publish",
      resource: room.id,
      decision: "FAKE ALLOW",
      effect: "saved",
      reason: "permissive_allow",
    };
    const listeners = new Map<string, () => void>();
    const published: {
      input: PublishInput;
      ack: (value: Ack<PublishResult>) => void;
    }[] = [];
    const socket = {
      on: vi.fn((event: string, listener: () => void) =>
        listeners.set(event, listener),
      ),
      once: vi.fn(),
      off: vi.fn(),
      disconnect: vi.fn(),
      emit: vi.fn((event, input, ack) => {
        if (event === realtimeEvents.client.enterRoom)
          ack({
            ok: true,
            value: {
              room,
              members: [],
              messages: [],
              nextSequence: 0,
              hasMore: false,
              replayed: false,
              outcome,
            },
          });
        else if (event === realtimeEvents.client.publishMessage)
          published.push({ input, ack });
      }),
    };
    socketFactory.mockReturnValue(socket);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url === "/api/session"
                ? {
                    user: { id: "user-mei", name: "Mei" },
                    rooms: [room],
                    csrfToken: "csrf",
                    authzMode: "permissive",
                  }
                : { ticket: "test-ticket" },
            ),
          ),
      ),
    );
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    try {
      await act(async () => root.render(<App />));
      await act(async () => listeners.get("connect")?.());
      await act(async () =>
        element.querySelector<HTMLButtonElement>(".room")?.click(),
      );
      const input = element.querySelector<HTMLTextAreaElement>("#message");
      if (!input) throw new Error("Composer was not rendered");
      const type = async (text: string) =>
        act(async () => {
          Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
          )?.set?.call(input, text);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      const enter = (options: KeyboardEventInit = {}) =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
            ...options,
          }),
        );
      await type("   ");
      await act(async () => {
        enter();
      });
      expect(published).toHaveLength(0);
      await type("Hello room");
      await act(async () => {
        enter({ shiftKey: true });
        enter({ isComposing: true });
        enter({ repeat: true });
      });
      expect(published).toHaveLength(0);
      await act(async () => {
        enter();
        enter();
      });
      expect(published).toHaveLength(1);
      expect(published[0]?.input.content).toBe("Hello room");
      expect(input.value).toBe("Hello room");
      await act(async () =>
        published[0]?.ack({
          ok: false,
          error: { code: "save_failed", message: "Try again" },
        }),
      );
      expect(input.value).toBe("Hello room");
      await act(async () => {
        enter();
      });
      expect(published).toHaveLength(2);
      await act(async () =>
        published[1]?.ack({
          ok: true,
          value: {
            duplicate: false,
            outcome,
            message: {
              id: "message-test",
              roomId: room.id,
              authorId: "user-mei",
              authorName: "Mei",
              content: "Hello room",
              sequence: 1,
              version: 1,
              deleted: false,
              createdAt: "2030-01-01T00:00:00Z",
            },
          },
        }),
      );
      expect(input.value).toBe("");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("retries a fresh ticket when the browser comes online after retries are exhausted", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (url: string) => {
      if (url === "/api/session")
        return new Response(
          JSON.stringify({
            user: { id: "user-mei", name: "Mei" },
            rooms: [],
            csrfToken: "test-csrf",
            expiresAt: "2030-01-01T00:00:00Z",
            authzMode: "permissive",
          }),
        );
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", request);
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    try {
      await act(async () => root.render(<App />));
      await act(async () => vi.runAllTimersAsync());
      expect(element.textContent).toContain("Realtime unavailable");
      const attempts = request.mock.calls.length;
      await act(async () => window.dispatchEvent(new Event("online")));
      expect(request.mock.calls.length).toBe(attempts + 1);
      expect(request.mock.calls.at(-1)?.[0]).toBe("/api/connection-ticket");
      expect(element.textContent).toContain("Reconnecting");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("renders the P1-derived signed-out participant experience", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "authentication_required" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    await act(async () => root.render(<App />));
    expect(element.querySelector("h1")?.textContent).toBe(
      "P9 - Securing Realtime Chat Rooms and Events with Cedarling",
    );
    expect(
      [...element.querySelectorAll<HTMLAnchorElement>(".account-choice")].map(
        (item) => item.getAttribute("href"),
      ),
    ).toEqual([
      "/auth/login?login_hint=mei",
      "/auth/login?login_hint=kwame",
      "/auth/login?login_hint=yuki",
    ]);
    expect(element.textContent).toContain("Cedarling.dev");
    expect(element.textContent).not.toContain("synthetic local data");
    await act(async () => root.unmount());
  });
});
