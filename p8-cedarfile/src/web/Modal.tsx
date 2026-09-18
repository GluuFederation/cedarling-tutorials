import { X } from "./icons.tsx";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";

export function Modal({
  title,
  children,
  onClose,
  returnFocus,
}: Readonly<{
  title: string;
  children: ReactNode;
  onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}>) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = dialog.current?.querySelector<HTMLElement>(
      "button, input, select, textarea, [href]",
    );
    first?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]",
        ),
      ];
      if (focusable.length === 0) return;
      const firstItem = focusable[0];
      const lastItem = focusable.at(-1);
      if (!firstItem || !lastItem) return;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      (returnFocus?.current ?? previous)?.focus();
    };
  }, [onClose, returnFocus]);

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        aria-labelledby="dialog-title"
        aria-modal="true"
        className="modal"
        ref={dialog}
        role="dialog"
      >
        <header>
          <h2 id="dialog-title">{title}</h2>
          <button
            aria-label="Close dialog"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
