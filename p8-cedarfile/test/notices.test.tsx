// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransientNotice, type Notice } from "../src/web/TransientNotice";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("operation notices", () => {
  it.each([
    ["success", 5_000],
    ["error", 8_000],
  ] as const)(
    "dismisses %s after its reading interval",
    async (kind, duration) => {
      const target = document.createElement("div");
      document.body.append(target);
      const root = createRoot(target);
      const dismiss = vi.fn();
      try {
        await act(async () =>
          root.render(
            <TransientNotice
              notice={{ kind, text: "Operation finished" }}
              onDismiss={dismiss}
            />,
          ),
        );
        await act(async () => vi.advanceTimersByTime(duration - 1));
        expect(dismiss).not.toHaveBeenCalled();
        await act(async () => vi.advanceTimersByTime(1));
        expect(dismiss).toHaveBeenCalledOnce();
      } finally {
        await act(async () => root.unmount());
        target.remove();
      }
    },
  );

  it("pauses while hovered or focused, resets for a new notice, and supports dismissal", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    const dismiss = vi.fn();
    const notice: Notice = { kind: "success", text: "Saved" };
    try {
      await act(async () =>
        root.render(<TransientNotice notice={notice} onDismiss={dismiss} />),
      );
      await act(async () => vi.advanceTimersByTime(3_000));
      const message = target.querySelector(".transient-notice");
      const button = target.querySelector("button");
      if (!message || !button) throw new Error("Notice was not rendered");
      await act(async () =>
        message.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
      );
      await act(async () => vi.advanceTimersByTime(10_000));
      await act(async () => button.focus());
      await act(async () =>
        message.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })),
      );
      await act(async () => vi.advanceTimersByTime(10_000));
      expect(dismiss).not.toHaveBeenCalled();
      await act(async () => button.blur());
      await act(async () => vi.advanceTimersByTime(1_000));
      expect(dismiss).not.toHaveBeenCalled();
      await act(async () =>
        root.render(
          <TransientNotice
            notice={{ kind: "error", text: "Retry failed" }}
            onDismiss={dismiss}
          />,
        ),
      );
      await act(async () => vi.advanceTimersByTime(7_999));
      expect(dismiss).not.toHaveBeenCalled();
      expect(target.querySelector('[role="alert"]')).not.toBeNull();
      await act(async () => button.click());
      expect(dismiss).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      target.remove();
    }
    await act(async () => vi.runAllTimers());
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
