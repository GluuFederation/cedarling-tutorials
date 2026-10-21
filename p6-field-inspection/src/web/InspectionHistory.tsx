import { tutorialUsers } from "../shared/catalog.ts";
import type { Inspection } from "../shared/types.ts";
import { ChecklistSummary } from "./ChecklistSummary.tsx";

export function InspectionHistory({
  items,
}: Readonly<{ items: readonly Inspection[] }>) {
  return (
    <>
      {items.length > 0 && (
        <section className="inspection-history" aria-label="Inspection history">
          <h3>Submitted inspections</h3>
          {items.length > 1 && <p className="help-text">Newest first.</p>}
          {items.map((inspection) => (
            <details key={inspection.id} open={inspection.id === items[0]?.id}>
              <summary>
                <time dateTime={inspection.createdAt}>
                  {new Date(inspection.createdAt).toLocaleString()}
                </time>{" "}
                ·{" "}
                {tutorialUsers.find(
                  (user) => user.id === inspection.submittedBy,
                )?.name ?? inspection.submittedBy}
              </summary>
              <ChecklistSummary checklist={inspection.checklist} />
              {inspection.notes && (
                <p className="saved-notes">{inspection.notes}</p>
              )}
              {inspection.review ? (
                <div className="inspection-review">
                  <p>
                    Reviewed by{" "}
                    {tutorialUsers.find(
                      (user) => user.id === inspection.review?.reviewedBy,
                    )?.name ?? inspection.review.reviewedBy}
                    :{" "}
                    {inspection.review.outcome === "complete"
                      ? "Completed"
                      : "Changes requested"}
                    .
                  </p>
                  {inspection.review.notes && (
                    <p className="saved-notes">
                      <em>{inspection.review.notes}</em>
                    </p>
                  )}
                </div>
              ) : (
                <p>Awaiting review.</p>
              )}
            </details>
          ))}
        </section>
      )}
    </>
  );
}
