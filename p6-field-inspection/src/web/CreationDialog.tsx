import { useEffect, useRef } from "react";
import { technicians } from "../shared/catalog.ts";
import type { WorkOrderCreation } from "../shared/types.ts";

export function CreationDialog({
  value,
  busy,
  online,
  error,
  onChange,
  onCancel,
  onSubmit,
}: Readonly<{
  value: WorkOrderCreation;
  busy: boolean;
  online: boolean;
  error: string;
  onChange: (value: WorkOrderCreation) => void;
  onCancel: () => void;
  onSubmit: () => void;
}>) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    element?.querySelector("input")?.focus();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      className="create-dialog"
      ref={dialog}
      aria-labelledby="create-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "input, select, button",
          ),
        ).filter((element) => !element.matches(":disabled"));
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && online) onSubmit();
        }}
      >
        <h2 id="create-title">New work order</h2>
        <p>Choose the equipment, site, and initial technician.</p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {!online && (
          <p role="status">
            Reconnect to add this work order. Your entries are kept here.
          </p>
        )}
        <fieldset disabled={busy} className="create-fields">
          <label>
            Equipment
            <input
              required
              maxLength={80}
              value={value.equipment}
              onChange={(event) =>
                onChange({ ...value, equipment: event.target.value })
              }
            />
          </label>
          <label>
            Site
            <input
              required
              maxLength={80}
              value={value.site}
              onChange={(event) =>
                onChange({ ...value, site: event.target.value })
              }
            />
          </label>
          <label>
            Initial technician
            <select
              value={value.technicianId}
              onChange={(event) =>
                onChange({ ...value, technicianId: event.target.value })
              }
            >
              {technicians.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={
              busy || !online || !value.equipment.trim() || !value.site.trim()
            }
          >
            {busy ? "Adding…" : "Add to queue"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
