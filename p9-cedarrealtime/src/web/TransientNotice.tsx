import { useEffect, useRef, useState } from "react";
import { X } from "./icons.tsx";

export type Notice = { kind: "success" | "error"; text: string };

export function TransientNotice({
  notice,
  onDismiss,
}: Readonly<{ notice: Notice; onDismiss: () => void }>) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const clock = useRef({
    notice,
    remaining: notice.kind === "error" ? 8_000 : 5_000,
  });

  useEffect(() => {
    if (clock.current.notice !== notice) {
      clock.current = {
        notice,
        remaining: notice.kind === "error" ? 8_000 : 5_000,
      };
    }
    if (hovered || focused) return;
    const started = Date.now();
    const timer = window.setTimeout(onDismiss, clock.current.remaining);
    return () => {
      window.clearTimeout(timer);
      clock.current.remaining = Math.max(
        0,
        clock.current.remaining - (Date.now() - started),
      );
    };
  }, [notice, onDismiss, hovered, focused]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Hover and focus only pause the timer; the native button handles dismissal.
    <div
      className={`notice ${notice.kind} transient-notice`}
      role={notice.kind === "error" ? "alert" : "status"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <span>{notice.text}</span>
      <button
        type="button"
        className="notice-dismiss"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
