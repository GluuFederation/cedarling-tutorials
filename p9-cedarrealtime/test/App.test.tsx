// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/web/App.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("CedarRealtime shell", () => {
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
