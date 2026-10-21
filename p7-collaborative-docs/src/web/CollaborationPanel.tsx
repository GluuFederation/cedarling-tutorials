import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DocumentDetail } from "../shared/types.ts";
import type { CollaborationTab } from "./Collaboration.tsx";
import { Modal } from "./Modal.tsx";

export function CollaborationPanel({
  open,
  close,
  tab,
  setTab,
  detail,
  children,
}: Readonly<{
  open: boolean;
  close: () => void;
  tab: CollaborationTab;
  setTab: (tab: CollaborationTab) => void;
  detail: DocumentDetail;
  children: ReactNode;
}>) {
  const [wide, setWide] = useState(
    () => matchMedia("(min-width: 1280px)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(min-width: 1280px)");
    const update = () => {
      setWide(query.matches);
      close();
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [close]);
  const content = (
    <>
      <div className="collaboration-heading">
        <h3>Collaboration</h3>
        <button type="button" onClick={close} aria-label="Close collaboration">
          Close
        </button>
      </div>
      <div
        className="collaboration-tabs"
        role="tablist"
        aria-label="Collaboration"
      >
        {(["comments", "access"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`${value}-tab`}
            aria-controls={`${value}-panel`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "comments"
                    : event.key === "End"
                      ? "access"
                      : tab === "comments"
                        ? "access"
                        : "comments";
                setTab(next);
                document.getElementById(`${next}-tab`)?.focus();
              }
            }}
          >
            {value === "comments"
              ? `Comments (${detail.comments.length}${detail.hasOlderComments ? "+" : ""})`
              : `Access (${detail.members.length})`}
          </button>
        ))}
      </div>
      {children}
    </>
  );
  if (!wide)
    return createPortal(
      <Modal
        open={open}
        close={close}
        label="Collaboration"
        className="collaboration-drawer"
      >
        {content}
      </Modal>,
      document.body,
    );
  return open ? (
    <aside className="collaboration-panel" aria-label="Collaboration">
      {content}
    </aside>
  ) : null;
}
