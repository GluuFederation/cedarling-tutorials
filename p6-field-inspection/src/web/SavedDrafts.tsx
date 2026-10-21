import { useState } from "react";
import { ChecklistSummary } from "./ChecklistSummary.tsx";
import type { InspectionDraft } from "./drafts.ts";

export function SavedDrafts({
  items,
  busy,
  onDiscard,
}: Readonly<{
  items: readonly InspectionDraft[];
  busy: boolean;
  onDiscard: (draft: InspectionDraft) => void;
}>) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <details
      className="saved-drafts"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Saved drafts on this device ({items.length})</summary>
      <p>
        These copies stay on this device, including when a work order becomes
        unavailable. Check Activity for submissions accepted by the server.
      </p>
      {open &&
        items.map((draft) => (
          <section key={draft.key} className="saved-draft">
            <h3>{draft.workOrderId}</h3>
            <p>
              {draft.status === "queued"
                ? "Queued"
                : draft.status === "orphaned"
                  ? "Work order unavailable"
                  : "Draft"}{" "}
              · Work version {draft.expectedWorkOrderVersion}
            </p>
            <ChecklistSummary checklist={draft.checklist} />
            <p className="saved-notes">{draft.notes || "No notes."}</p>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Discard this saved draft? Its local notes and answers will be removed.",
                  )
                )
                  onDiscard(draft);
              }}
            >
              Discard draft
            </button>
          </section>
        ))}
    </details>
  );
}
