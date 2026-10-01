"use client";

/** Presentation only: native disabled state and pending feedback never replace server checks. */
import { useId } from "react";
import { useFormStatus } from "react-dom";
import { Check } from "@/src/web/icons.tsx";

export function ActionButton({
  allowed,
  label,
  reason,
  primary = false,
}: {
  allowed: boolean;
  label: string;
  reason: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  const id = useId();
  return (
    <div className="action-control">
      <button
        className={primary ? "primary" : "secondary"}
        type="submit"
        disabled={!allowed || pending}
        aria-describedby={!allowed ? id : undefined}
      >
        {primary && !pending && <Check />}
        {pending ? "Working…" : label}
      </button>
      {!allowed && (
        <p id={id} className="permission-note">
          {reason}
        </p>
      )}
    </div>
  );
}
