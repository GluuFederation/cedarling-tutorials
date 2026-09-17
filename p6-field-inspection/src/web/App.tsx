import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { capabilities } from "../shared/capabilities.ts";
import {
  checklistItems,
  technicians,
  tutorialUsers,
} from "../shared/catalog.ts";
import type {
  Checklist,
  Session,
  WorkOrder,
  WorkOrderDetail,
} from "../shared/types.ts";
import { ApiError, api } from "./api.ts";
import cedarlingMark from "./assets/cedarling-mark.png";
import cedarlingWordmark from "./assets/cedarling-wordmark-dark.webp";
import { authorizePresentation } from "./authorization.ts";
import { drafts, type InspectionDraft } from "./drafts.ts";

type Notice = { kind: "success" | "error"; text: string } | null;
type SessionState =
  | { kind: "loading" }
  | { kind: "authenticated"; session: Session }
  | { kind: "unauthenticated"; expired: boolean }
  | { kind: "error" };
const emptyChecklist: Checklist = {
  safetyGuardSecured: false,
  fluidLevelChecked: false,
  operatingTemperatureRecorded: false,
};

function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "state_conflict")
      return "The work order changed. Review its current state.";
    if (error.code === "forbidden")
      return "The current identity cannot perform this action.";
    if (error.code === "authentication_required")
      return "Your session expired.";
  }
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function BrandRail({
  session,
  signOut,
}: Readonly<{ session?: Session; signOut?: () => void }>) {
  return (
    <header className="brand-rail">
      <picture className="brand-lockup">
        <source media="(max-width: 760px)" srcSet={cedarlingMark} />
        <img src={cedarlingWordmark} alt="Cedarling" />
      </picture>
      <div className="topbar-copy">
        <h1>P6 - Reauthorizing Offline Field Inspections with Cedarling</h1>
        <p>Recheck current assignment before every inspection effect.</p>
      </div>
      {session ? (
        <details className="account-menu">
          <summary className="rail-identity" aria-label="Open account menu">
            <span className="identity-avatar" aria-hidden="true">
              {session.user.name
                .split(" ")
                .map((part) => part[0])
                .join("")}
            </span>
            <span className="identity-copy">
              <strong>{session.user.name}</strong>
              <small>{session.user.role}</small>
            </span>
          </summary>
          <div className="account-menu-items">
            <button type="button" onClick={signOut}>
              Change account
            </button>
            <button type="button" onClick={signOut}>
              Sign out
            </button>
          </div>
        </details>
      ) : (
        <span aria-hidden="true" />
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer>
      <nav aria-label="Related resources">
        <a href="https://cedarling.dev">Cedarling.dev</a>
        <a href="https://docs.jans.io/stable/cedarling/">Cedarling Docs</a>
        <a href="https://gluu.org/agama-lab/">Agama Lab</a>
        <a href="https://docs.jans.io/stable/cedarling/reference/cedarling-lock-server/">
          Lock Server
        </a>
        <a href="https://gluu.org">Gluu</a>
      </nav>
    </footer>
  );
}

function Login({ expired = false }: Readonly<{ expired?: boolean }>) {
  return (
    <div className="app-shell">
      <BrandRail />
      <main className="login-main">
        <section className="login-panel" aria-labelledby="login-title">
          <h2 id="login-title">Choose a tutorial identity</h2>
          <p>Compare one field workflow across current assignments.</p>
          {expired && (
            <p className="notice error" role="alert">
              Session expired. Choose an identity again.
            </p>
          )}
          <nav className="account-choices" aria-label="Tutorial identities">
            {tutorialUsers.map((user) => (
              <a
                key={user.id}
                href={`/auth/login?login_hint=${user.subject}`}
                className="account-choice"
              >
                <span className="account-avatar" aria-hidden="true">
                  {user.name
                    .split(" ")
                    .map((part) => part[0])
                    .join("")}
                </span>
                <span>
                  <strong>{user.name}</strong>
                  <small>
                    {user.role === "supervisor"
                      ? "Field supervisor"
                      : "Field technician"}
                  </small>
                </span>
                <span aria-hidden="true">→</span>
              </a>
            ))}
          </nav>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function ServiceFailure({ retry }: Readonly<{ retry: () => void }>) {
  return (
    <div className="app-shell">
      <BrandRail />
      <main className="login-main">
        <section className="service-state" aria-labelledby="service-title">
          <h2 id="service-title">Application unavailable</h2>
          <p>The session service could not be reached.</p>
          <button className="primary" type="button" onClick={retry}>
            Retry
          </button>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Workspace({
  session,
  expired,
}: Readonly<{ session: Session; expired: () => void }>) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [createAllowed, setCreateAllowed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newOrder, setNewOrder] = useState({
    equipment: "",
    site: "",
    technicianId: "user-elena",
  });
  const [selectedId, setSelectedId] = useState(
    () => new URLSearchParams(location.search).get("workOrder") ?? "",
  );
  const [detail, setDetail] = useState<WorkOrderDetail>();
  const [draft, setDraft] = useState<InspectionDraft>();
  const [orphanedDrafts, setOrphanedDrafts] = useState<InspectionDraft[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [loadError, setLoadError] = useState("");
  const [target, setTarget] = useState("user-malik");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [envelopeClock, setEnvelopeClock] = useState(() => Date.now());
  const reconnectPending = useRef(false);

  const reloadList = useCallback(async (): Promise<readonly WorkOrder[]> => {
    try {
      const result = await api.workOrders();
      setWorkOrders(result.workOrders);
      setCreateAllowed(result.createAllowed);
      setSelectedId((current) =>
        current && result.workOrders.some((item) => item.id === current)
          ? current
          : (result.workOrders[0]?.id ?? ""),
      );
      setLoadError("");
      return result.workOrders;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expired();
      setLoadError(message(error));
      return [];
    }
  }, [expired]);

  const reloadDetail = useCallback(async () => {
    if (!selectedId) return setDetail(undefined);
    try {
      const result = await api.workOrder(selectedId);
      setDetail(result);
      setTarget(
        technicians.find((item) => item.id !== result.assigneeId)?.id ??
          result.assigneeId,
      );
      const stored = await drafts.get(drafts.key(session.user.id, selectedId));
      setDraft(stored);
      const url = new URL(location.href);
      url.searchParams.set("workOrder", selectedId);
      history.replaceState(null, "", url);
      setLoadError("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return expired();
      if (error instanceof ApiError && error.status === 404) {
        setDetail(undefined);
      }
      setLoadError(message(error));
    }
  }, [expired, selectedId, session.user.id]);

  useEffect(() => void reloadList(), [reloadList]);
  useEffect(() => {
    void drafts
      .orphaned(session.user.id)
      .then(setOrphanedDrafts)
      .catch((error: unknown) => setLoadError(message(error)));
  }, [session.user.id]);
  useEffect(() => {
    setDraft(undefined);
    setConfirmDelete(false);
    void reloadDetail();
  }, [reloadDetail]);
  useEffect(() => {
    setEnvelopeClock(Date.now());
    if (!detail) return;
    const delay = Math.max(
      0,
      Date.parse(detail.envelope.expiresAt) - Date.now() + 1,
    );
    const timer = setTimeout(
      () => setEnvelopeClock(Date.now()),
      Math.min(delay, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [detail]);
  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => {
      reconnectPending.current = true;
      setOnline(false);
    };
    addEventListener("online", connected);
    addEventListener("offline", disconnected);
    return () => {
      removeEventListener("online", connected);
      removeEventListener("offline", disconnected);
    };
  }, []);

  const currentDraft = useMemo<InspectionDraft | undefined>(() => {
    if (!detail) return undefined;
    return (
      draft ?? {
        key: drafts.key(session.user.id, detail.id),
        principalId: session.user.id,
        workOrderId: detail.id,
        expectedWorkOrderVersion: detail.workOrderVersion,
        checklist: emptyChecklist,
        notes: "",
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        status: "draft",
      }
    );
  }, [detail, draft, session.user.id]);

  const storeDraft = async (next: InspectionDraft, text: string) => {
    await drafts.put(next);
    setDraft(next);
    setNotice({ kind: "success", text });
  };

  const discardOrphaned = async (orphaned: InspectionDraft) => {
    try {
      await drafts.remove(orphaned.key);
      setOrphanedDrafts((current) =>
        current.filter((item) => item.key !== orphaned.key),
      );
      setNotice({ kind: "success", text: "Preserved draft discarded." });
    } catch (error) {
      setNotice({ kind: "error", text: message(error) });
    }
  };

  const sync = useCallback(
    async (queued = draft) => {
      if (queued?.status !== "queued" || !online) return;
      setBusy(true);
      try {
        const result = await api.submit(
          queued.workOrderId,
          {
            idempotencyKey: queued.idempotencyKey,
            expectedWorkOrderVersion: queued.expectedWorkOrderVersion,
            checklist: queued.checklist,
            notes: queued.notes,
          },
          session.csrfToken,
        );
        await drafts.remove(queued.key);
        setDraft(undefined);
        setNotice({
          kind: "success",
          text: result.replayed
            ? "Inspection already synchronized."
            : "Inspection synchronized and work order completed.",
        });
        const refreshed = await reloadList();
        const nextOpen = refreshed.find(
          (item) => item.status === "open" && item.id !== queued.workOrderId,
        );
        if (nextOpen) setSelectedId(nextOpen.id);
        else await reloadDetail();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return expired();
        if (error instanceof ApiError && error.status === 404) {
          const orphaned = { ...queued, status: "orphaned" as const };
          await drafts.put(orphaned);
          setDraft(undefined);
          setDetail(undefined);
          setOrphanedDrafts((current) => [
            orphaned,
            ...current.filter((item) => item.key !== orphaned.key),
          ]);
          setNotice({
            kind: "error",
            text: "The work order was removed. Your local inspection was preserved for review.",
          });
          await reloadList();
          return;
        }
        if (error instanceof ApiError && [403, 409].includes(error.status)) {
          const review = { ...queued, status: "draft" as const };
          await drafts.put(review);
          setDraft(review);
          await reloadList();
          await reloadDetail();
        }
        setNotice({ kind: "error", text: message(error) });
      } finally {
        setBusy(false);
      }
    },
    [draft, expired, online, reloadDetail, reloadList, session.csrfToken],
  );

  useEffect(() => {
    if (
      online &&
      reconnectPending.current &&
      draft?.status === "queued" &&
      !busy
    ) {
      reconnectPending.current = false;
      void sync(draft);
    }
  }, [busy, draft, online, sync]);

  const queueAllowed = Boolean(
    detail &&
      detail.status === "open" &&
      detail.envelope.ceiling[capabilities.submit] &&
      Date.parse(detail.envelope.expiresAt) > envelopeClock,
  );
  const reassignAllowed = Boolean(
    detail?.status === "open" && detail.envelope.ceiling[capabilities.reassign],
  );
  const deleteAllowed = Boolean(
    detail?.status === "open" && detail.envelope.ceiling[capabilities.delete],
  );
  const hasOpenWorkOrder = workOrders.some((item) => item.status === "open");

  const reassign = async () => {
    if (!detail || !reassignAllowed) return;
    if (
      !authorizePresentation({
        capability: capabilities.reassign,
        principalId: session.user.id,
        resourceId: detail.id,
      })
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.reassign(
        detail.id,
        {
          expectedAssignmentEpoch: detail.assignmentEpoch,
          technicianId: target,
        },
        session.csrfToken,
      );
      setNotice({ kind: "success", text: "Work order reassigned." });
      await reloadList();
      await reloadDetail();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return expired();
      setNotice({ kind: "error", text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const createWorkOrder = async () => {
    if (
      !online ||
      !createAllowed ||
      !newOrder.equipment.trim() ||
      !newOrder.site.trim()
    ) {
      return;
    }
    if (
      !authorizePresentation({
        capability: capabilities.create,
        principalId: session.user.id,
        resourceId: "work-orders",
      })
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await api.createWorkOrder(
        {
          equipment: newOrder.equipment,
          site: newOrder.site,
          technicianId: newOrder.technicianId,
        },
        session.csrfToken,
      );
      await reloadList();
      setSelectedId(result.workOrder.id);
      setNewOrder({
        equipment: "",
        site: "",
        technicianId: "user-elena",
      });
      setShowCreate(false);
      setNotice({ kind: "success", text: "Work order added." });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return expired();
      setNotice({ kind: "error", text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const deleteWorkOrder = async () => {
    if (!detail || !online || !deleteAllowed) return;
    if (
      !authorizePresentation({
        capability: capabilities.delete,
        principalId: session.user.id,
        resourceId: detail.id,
      })
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.deleteWorkOrder(
        detail.id,
        {
          expectedWorkOrderVersion: detail.workOrderVersion,
          expectedAssignmentEpoch: detail.assignmentEpoch,
        },
        session.csrfToken,
      );
      if (draft) await drafts.remove(draft.key);
      setDraft(undefined);
      setDetail(undefined);
      const refreshed = await reloadList();
      setSelectedId(refreshed[0]?.id ?? "");
      setNotice({ kind: "success", text: "Work order deleted." });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return expired();
      setConfirmDelete(false);
      setNotice({ kind: "error", text: message(error) });
      await reloadList();
      await reloadDetail();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <BrandRail
        session={session}
        signOut={async () => {
          await api.logout(session.csrfToken);
          location.assign("/");
        }}
      />
      <main className="workspace">
        <aside className="work-list" aria-label="Work orders">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Field queue</span>
              <h2>Work orders</h2>
            </div>
            <span className={`connectivity ${online ? "online" : "offline"}`}>
              {online ? "Online" : "Offline"}
            </span>
          </div>
          <button
            className="add-order-toggle secondary"
            type="button"
            disabled={!online || !createAllowed || busy}
            aria-expanded={showCreate}
            onClick={() => setShowCreate((current) => !current)}
          >
            {showCreate ? "Cancel" : "Add work order"}
          </button>
          {showCreate && (
            <form
              className="create-order"
              onSubmit={(event) => {
                event.preventDefault();
                void createWorkOrder();
              }}
            >
              <label>
                <span>Equipment</span>
                <input
                  required
                  maxLength={80}
                  value={newOrder.equipment}
                  onChange={(event) =>
                    setNewOrder((current) => ({
                      ...current,
                      equipment: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>Site</span>
                <input
                  required
                  maxLength={80}
                  value={newOrder.site}
                  onChange={(event) =>
                    setNewOrder((current) => ({
                      ...current,
                      site: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>Initial technician</span>
                <select
                  value={newOrder.technicianId}
                  onChange={(event) =>
                    setNewOrder((current) => ({
                      ...current,
                      technicianId: event.target.value,
                    }))
                  }
                >
                  {technicians.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                type="submit"
                disabled={
                  busy || !newOrder.equipment.trim() || !newOrder.site.trim()
                }
              >
                Add to queue
              </button>
            </form>
          )}
          {loadError && (
            <p className="notice error" role="alert">
              {loadError}
            </p>
          )}
          <div className="work-items">
            {workOrders.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`work-item ${selectedId === item.id ? "selected" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <strong>{item.equipment}</strong>
                <span>{item.site}</span>
                <small>
                  {item.assigneeName} · {item.status}
                </small>
              </button>
            ))}
          </div>
        </aside>
        <section className="detail-panel" aria-live="polite">
          {notice && (
            <p className={`notice ${notice.kind}`} role="status">
              {notice.text}
            </p>
          )}
          {orphanedDrafts.map((orphaned) => {
            const completedItems = checklistItems
              .filter((item) => orphaned.checklist[item.key])
              .map((item) => item.label);
            return (
              <section className="orphaned-draft" key={orphaned.key}>
                <div>
                  <span className="eyebrow">Removed work order</span>
                  <h2>Preserved inspection draft</h2>
                  <p>
                    {orphaned.workOrderId} no longer exists. Review this local
                    copy, then discard it when it is no longer needed.
                  </p>
                  <dl>
                    <div>
                      <dt>Checklist</dt>
                      <dd>
                        {completedItems.length > 0
                          ? completedItems.join(", ")
                          : "No items selected"}
                      </dd>
                    </div>
                    <div>
                      <dt>Notes</dt>
                      <dd>{orphaned.notes || "No notes"}</dd>
                    </div>
                  </dl>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void discardOrphaned(orphaned)}
                >
                  Discard draft
                </button>
              </section>
            );
          })}
          {!detail ? (
            <div className="empty-state">
              <h2>Select a work order</h2>
              <p>Choose an inspection from the queue.</p>
            </div>
          ) : (
            <>
              <header className="detail-heading">
                <div>
                  <span className="eyebrow">{detail.site}</span>
                  <h2>{detail.equipment}</h2>
                </div>
                <span className={`status ${detail.status}`}>
                  {detail.status}
                </span>
              </header>
              <dl className="facts">
                <div>
                  <dt>Assigned to</dt>
                  <dd>{detail.assigneeName}</dd>
                </div>
                <div>
                  <dt>Work version</dt>
                  <dd>{detail.workOrderVersion}</dd>
                </div>
                <div>
                  <dt>Assignment epoch</dt>
                  <dd>{detail.assignmentEpoch}</dd>
                </div>
                <div>
                  <dt>Draft</dt>
                  <dd>{draft?.status ?? "Not saved"}</dd>
                </div>
              </dl>
              {detail.status === "completed" ? (
                <section className="completion-state">
                  <strong>Inspection completed</strong>
                  <p>
                    This work order is read-only.
                    {hasOpenWorkOrder
                      ? " Select an open work order from the field queue to continue."
                      : " All current work orders are complete."}
                  </p>
                </section>
              ) : (
                <>
                  <div className="form-grid">
                    <fieldset disabled={busy}>
                      <legend>Inspection checklist</legend>
                      {checklistItems.map((item) => (
                        <label className="check-row" key={item.key}>
                          <input
                            type="checkbox"
                            checked={currentDraft?.checklist[item.key] ?? false}
                            onChange={(event) =>
                              currentDraft &&
                              setDraft({
                                ...currentDraft,
                                checklist: {
                                  ...currentDraft.checklist,
                                  [item.key]: event.target.checked,
                                },
                              })
                            }
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </fieldset>
                    <label className="notes-field">
                      <span>Inspection notes</span>
                      <textarea
                        maxLength={1000}
                        disabled={busy}
                        value={currentDraft?.notes ?? ""}
                        onChange={(event) =>
                          currentDraft &&
                          setDraft({
                            ...currentDraft,
                            notes: event.target.value,
                          })
                        }
                        placeholder="Add concise site observations"
                      />
                    </label>
                  </div>
                  <div className="actions">
                    <button
                      className="secondary"
                      type="button"
                      disabled={!currentDraft || busy}
                      onClick={() =>
                        currentDraft &&
                        void storeDraft(
                          { ...currentDraft, status: "draft" },
                          "Draft saved on this device.",
                        )
                      }
                    >
                      Save draft
                    </button>
                    <button
                      className="primary"
                      type="button"
                      disabled={
                        !currentDraft ||
                        busy ||
                        (draft?.status === "queued" ? !online : !queueAllowed)
                      }
                      onClick={() => {
                        if (!currentDraft) return;
                        if (draft?.status === "queued") {
                          void sync(draft);
                          return;
                        }
                        if (
                          !queueAllowed ||
                          Date.parse(detail.envelope.expiresAt) <= Date.now()
                        ) {
                          setEnvelopeClock(Date.now());
                          setNotice({
                            kind: "error",
                            text: "Refresh the work order before queuing this inspection.",
                          });
                          return;
                        }
                        if (
                          !authorizePresentation({
                            capability: capabilities.submit,
                            principalId: session.user.id,
                            resourceId: detail.id,
                          })
                        )
                          return;
                        const queued = {
                          ...currentDraft,
                          status: "queued" as const,
                        };
                        void storeDraft(
                          queued,
                          online
                            ? "Inspection queued for synchronization."
                            : "Inspection queued until reconnect.",
                        ).then(() => {
                          if (online) return sync(queued);
                        });
                      }}
                    >
                      {busy
                        ? "Working…"
                        : draft?.status === "queued"
                          ? "Retry synchronization"
                          : online
                            ? "Submit inspection"
                            : "Queue inspection"}
                    </button>
                  </div>
                  <div className="reassign-row">
                    <label>
                      <span>Assign technician</span>
                      <select
                        value={target}
                        disabled={busy}
                        onChange={(event) => setTarget(event.target.value)}
                      >
                        {technicians.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="secondary"
                      type="button"
                      disabled={
                        !online ||
                        !reassignAllowed ||
                        busy ||
                        target === detail.assigneeId
                      }
                      onClick={() => void reassign()}
                    >
                      Reassign
                    </button>
                    <div className="delete-actions">
                      {confirmDelete ? (
                        <>
                          <button
                            className="danger"
                            type="button"
                            disabled={busy}
                            onClick={() => void deleteWorkOrder()}
                          >
                            Confirm delete
                          </button>
                          <button
                            className="secondary"
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmDelete(false)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          className="danger-outline"
                          type="button"
                          disabled={!online || !deleteAllowed || busy}
                          onClick={() => setConfirmDelete(true)}
                        >
                          Delete order
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}

export function App() {
  const [sessionState, setSessionState] = useState<SessionState>({
    kind: "loading",
  });
  const loadSession = useCallback(async () => {
    setSessionState({ kind: "loading" });
    try {
      setSessionState({ kind: "authenticated", session: await api.session() });
    } catch (error) {
      setSessionState(
        error instanceof ApiError && error.status === 401
          ? { kind: "unauthenticated", expired: false }
          : { kind: "error" },
      );
    }
  }, []);
  useEffect(() => void loadSession(), [loadSession]);

  if (sessionState.kind === "loading")
    return <div className="loading">Loading CedarInspect…</div>;
  if (sessionState.kind === "error")
    return <ServiceFailure retry={() => void loadSession()} />;
  if (sessionState.kind === "unauthenticated")
    return <Login expired={sessionState.expired} />;
  return (
    <Workspace
      session={sessionState.session}
      expired={() =>
        setSessionState({ kind: "unauthenticated", expired: true })
      }
    />
  );
}
