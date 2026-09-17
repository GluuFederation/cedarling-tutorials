/** @vitest-environment jsdom */
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "../src/web/Modal";

function Harness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)} type="button">
        Open
      </button>
      {open && (
        <Modal
          labelledBy="test-modal-title"
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
        >
          <h2 id="test-modal-title">Test modal</h2>
          <input aria-label="First field" data-autofocus />
          <button onClick={() => setOpen(false)} type="button">
            Close
          </button>
        </Modal>
      )}
    </>
  );
}

describe("shared modal", () => {
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  });

  it("moves focus inside, traps Tab, closes with Escape, and restores focus", () => {
    act(() => root.render(<Harness />));
    const trigger = document.querySelector("button")!;
    act(() => trigger.click());

    const input = document.querySelector("input")!;
    const close = Array.from(document.querySelectorAll("button")).at(-1)!;
    expect(document.activeElement).toBe(input);

    close.focus();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(input);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes only when the backdrop itself is pressed", () => {
    act(() => root.render(<Harness />));
    const trigger = document.querySelector("button")!;
    act(() => trigger.click());

    const panel = document.querySelector<HTMLElement>(".modal-panel")!;
    act(() => {
      panel.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    act(() => {
      backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
