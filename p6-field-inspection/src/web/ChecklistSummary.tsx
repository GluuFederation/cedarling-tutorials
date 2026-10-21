import { checklistItems } from "../shared/catalog.ts";
import type { Checklist } from "../shared/types.ts";

export function ChecklistSummary({
  checklist,
}: Readonly<{
  checklist: Readonly<{ [Key in keyof Checklist]: boolean | null }>;
}>) {
  return (
    <ul className="checklist-summary" aria-label="Inspection results">
      {checklistItems.map((item) => {
        const result = checklist[item.key];
        return (
          <li key={item.key}>
            <span>{item.label}</span>
            <span
              className={`check-outcome ${result === true ? "pass" : result === false ? "fail" : "unanswered"}`}
            >
              {result === true
                ? "Pass"
                : result === false
                  ? "Fail"
                  : "Not answered"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
