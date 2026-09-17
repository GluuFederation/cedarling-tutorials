import { useEffect, useRef, type ReactNode, type RefObject } from "react";

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Modal({
  children,
  labelledBy,
  describedBy,
  onClose,
  triggerRef,
}: Readonly<{
  children: ReactNode;
  labelledBy: string;
  describedBy?: string;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
}>) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const initial =
      panel.querySelector<HTMLElement>("[data-autofocus]") ??
      panel.querySelector<HTMLElement>(focusableSelector);
    initial?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const controls = Array.from(
        panel?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) {
        event.preventDefault();
        panel?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
  }, [onClose, triggerRef]);

  return (
    <div
      className="modal-backdrop modal-backdrop--dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        aria-describedby={describedBy}
        aria-labelledby={labelledBy}
        aria-modal="true"
        className="modal-panel modal-panel--dialog"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
