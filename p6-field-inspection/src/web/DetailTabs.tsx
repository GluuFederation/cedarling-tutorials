import { useRef } from "react";

const tabs = [
  { id: "inspection", label: "Inspection" },
  { id: "activity", label: "Activity" },
  { id: "manage", label: "Manage order" },
] as const;
export type DetailTab = (typeof tabs)[number]["id"];

export function DetailTabs({
  active,
  onChange,
}: Readonly<{
  active: DetailTab;
  onChange: (tab: DetailTab) => void;
}>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div
      className="detail-tabs"
      role="tablist"
      aria-label="Work order sections"
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-controls={`panel-${tab.id}`}
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % tabs.length
                : event.key === "ArrowLeft"
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : undefined;
            if (next === undefined) return;
            event.preventDefault();
            const nextTab = tabs[next];
            if (!nextTab) return;
            onChange(nextTab.id);
            buttons.current[next]?.focus();
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
