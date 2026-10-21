import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Capability, capabilities } from "../shared/capabilities.ts";
import {
  checklistItems,
  technicians,
  tutorialUsers,
} from "../shared/catalog.ts";
import { noteBytes, noteLimitMessage, validNotes } from "../shared/notes.ts";
import type {
  InspectionReview,
  Session,
  WorkOrder,
  WorkOrderDetail,
} from "../shared/types.ts";
import { ApiError, api, type RequestEvidence } from "./api.ts";
import cedarlingMark from "./assets/cedarling-mark.png";
import cedarlingWordmark from "./assets/cedarling-wordmark-dark.webp";
import { authorizePresentation } from "./authorization.ts";
import { ChecklistSummary } from "./ChecklistSummary.tsx";
import { CreationDialog } from "./CreationDialog.tsx";
import { type DetailTab, DetailTabs } from "./DetailTabs.tsx";
import {
  answered,
  DraftStorageError,
  drafts,
  emptyChecklist,
  IncompatibleDraftError,
  type InspectionDraft,
} from "./drafts.ts";
import { InspectionHistory } from "./InspectionHistory.tsx";
import { SavedDrafts } from "./SavedDrafts.tsx";
import {
  type OperationDetails,
  TechnicalDetails,
} from "./TechnicalDetails.tsx";

type Notice = { kind: "success" | "error"; text: string } | null;
type SessionState =
  | { kind: "loading" }
  | { kind: "authenticated"; session: Session }
  | { kind: "unauthenticated"; expired: boolean }
  | { kind: "error" };
const editable = (status: WorkOrder["status"]) =>
  status === "open" || status === "changes_requested";
const statusLabel = (status: WorkOrder["status"]) =>
  ({
    open: "Open",
    awaiting_review: "Awaiting review",
    changes_requested: "Changes requested",
    completed: "Completed",
  })[status];

function message(error: unknown): string {
  if (
    error instanceof IncompatibleDraftError ||
    error instanceof DraftStorageError
  )
    return error.message;
  if (error instanceof ApiError) {
    if (error.code === "not_found") return "This work order is unavailable.";
    if (error.code === "invalid_csrf" || error.code === "invalid_origin")
      return "The request could not be verified. Reload the page and try again.";
    if (error.code === "idempotency_conflict")
      return "This submission changed after it was sent. Refresh the work order before submitting again.";
    if (error.code === "state_conflict")
      return "The work order changed. Review its current state.";
    if (error.code === "forbidden")
      return "Your account cannot perform this action.";
    if (error.code === "authentication_required")
      return "Your session expired.";
    if (error.code === "failure_notes_required")
      return "Describe the failed checks in the inspection notes.";
    if (error.code === "invalid_checklist")
      return "Choose Pass or Fail for every check.";
    if (error.code === "invalid_notes" || error.code === "invalid_review_notes")
      return noteLimitMessage;
    if (error.code === "corrections_required")
      return "Failed checks must be corrected before this work order can be completed.";
    if (error.status === 400) return "Check the entries and try again.";
  }
  return "The request could not be completed. Check your connection and try again.";
}

function BrandRail({
  session,
  signOut,
  busy = false,
}: Readonly<{ session?: Session; signOut?: () => void; busy?: boolean }>) {
  return (
    <header className="brand-rail">
      <picture className="brand-lockup">
        <source
          media="(max-width: 760px), (max-height: 500px) and (orientation: landscape)"
          srcSet={cedarlingMark}
        />
        <img src={cedarlingWordmark} alt="Cedarling" />
      </picture>
      <div className="topbar-copy">
        <h1>P6 - Reauthorizing Offline Field Inspections with Cedarling</h1>
        <p>
          Check current access when an offline inspection reaches the server.
        </p>
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
            <button type="button" disabled={busy} onClick={signOut}>
              Change account
            </button>
            <button type="button" disabled={busy} onClick={signOut}>
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
        <a
          href="https://cedarling.dev"
          target="_blank"
          rel="noopener noreferrer"
        >
          Cedarling.dev
        </a>
        <a
          href="https://docs.jans.io/stable/cedarling/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Cedarling Docs
        </a>
        <a
          href="https://gluu.org/agama-lab/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Agama Lab
        </a>
        <a
          href="https://docs.jans.io/stable/cedarling/reference/cedarling-lock-server/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Lock Server
        </a>
        <a href="https://gluu.org" target="_blank" rel="noopener noreferrer">
          Gluu
        </a>
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
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const listGeneration = useRef(0);
  const loadingMore = useRef(false);
  const [createAllowed, setCreateAllowed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState("");
  const creating = useRef(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("inspection");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
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
  const [savedDrafts, setSavedDrafts] = useState<InspectionDraft[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [operation, setOperation] = useState<OperationDetails>();
  const refreshInFlight = useRef(false);
  const [incompatibleDrafts, setIncompatibleDrafts] = useState<
    { key: string; workOrderId: string; notes: string }[]
  >([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [loadError, setLoadError] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [retryingStorage, setRetryingStorage] = useState(false);
  const storageFailed = useRef(false);
  const [target, setTarget] = useState("user-malik");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [envelopeClock, setEnvelopeClock] = useState(() => Date.now());
  const reconnectPending = useRef(false);
  const submitting = useRef(false);
  const detailGeneration = useRef(0);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const [reviewNotes, setReviewNotes] = useState("");
  const reviewAttempt = useRef<InspectionReview | undefined>(undefined);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const filteredOrders = workOrders.filter(
    (order) =>
      (!statusFilter || order.status === statusFilter) &&
      (!assigneeFilter || order.assigneeId === assigneeFilter) &&
      `${order.equipment} ${order.site} ${order.id}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const storageFailure = useCallback((error: unknown) => {
    storageFailed.current = true;
    setStorageReady(false);
    setStorageError(message(error));
  }, []);
  const reportError = (error: unknown) => {
    if (error instanceof DraftStorageError) {
      storageFailure(error);
      setNotice(null);
    } else setNotice({ kind: "error", text: message(error) });
  };
  const reloadSavedDrafts = useCallback(async () => {
    try {
      const [saved, incompatible] = await Promise.all([
        drafts.saved(session.user.id),
        drafts.incompatible(session.user.id),
      ]);
      setSavedDrafts(saved);
      setIncompatibleDrafts(incompatible);
      if (!storageFailed.current) setStorageReady(true);
      return true;
    } catch (error) {
      storageFailure(error);
      return false;
    }
  }, [session.user.id, storageFailure]);

  const preflight = (capability: Capability, resourceId: string) => {
    const allowed = authorizePresentation({
      capability,
      principalId: session.user.id,
      resourceId,
    });
    setOperation({ capability, local: allowed });
    return allowed;
  };
  const observeRequest = useCallback((server: RequestEvidence) => {
    setOperation((current) => ({
      capability: current?.capability ?? capabilities.submit,
      local: current?.local,
      server,
    }));
  }, []);

  const reloadList = useCallback(async (): Promise<readonly WorkOrder[]> => {
    const generation = ++listGeneration.current;
    loadingMore.current = false;
    setListLoading(true);
    setNextOffset(null);
    try {
      const result = await api.workOrders();
      if (generation !== listGeneration.current) return [];
      setWorkOrders(result.workOrders);
      setNextOffset(result.nextOffset);
      setCreateAllowed(result.createAllowed);
      // A bounded queue omitting a selected order is not proof of lost access.
      setSelectedId((current) => current || result.workOrders[0]?.id || "");
      setListError("");
      return result.workOrders;
    } catch (error) {
      if (generation !== listGeneration.current) return [];
      if (error instanceof ApiError && error.status === 401) expired();
      setListError(message(error));
      return [];
    } finally {
      if (generation === listGeneration.current) setListLoading(false);
    }
  }, [expired]);

  const loadMore = async () => {
    if (nextOffset === null || listLoading || loadingMore.current) return;
    const generation = listGeneration.current;
    loadingMore.current = true;
    setListLoading(true);
    try {
      const result = await api.workOrders(nextOffset);
      if (generation !== listGeneration.current) return;
      setWorkOrders((current) => [
        ...new Map(
          [...current, ...result.workOrders].map((order) => [order.id, order]),
        ).values(),
      ]);
      setNextOffset(result.nextOffset);
      setCreateAllowed(result.createAllowed);
      setListError("");
    } catch (error) {
      if (generation !== listGeneration.current) return;
      if (error instanceof ApiError && error.status === 401) expired();
      setListError(message(error));
    } finally {
      if (generation === listGeneration.current) {
        loadingMore.current = false;
        setListLoading(false);
      }
    }
  };

  const reloadDetail = useCallback(async () => {
    const generation = ++detailGeneration.current;
    if (!selectedId) return setDetail(undefined);
    let stored: InspectionDraft | undefined;
    try {
      stored = await drafts
        .get(drafts.key(session.user.id, selectedId))
        .catch((error: unknown) => {
          if (error instanceof IncompatibleDraftError) {
            const key = drafts.key(session.user.id, selectedId);
            setIncompatibleDrafts((current) => [
              ...current.filter((item) => item.key !== key),
              { key, workOrderId: selectedId, notes: error.notes },
            ]);
            return undefined;
          }
          storageFailure(error);
          return undefined;
        });
      if (generation !== detailGeneration.current) return;
      const result = await api.workOrder(selectedId);
      if (generation !== detailGeneration.current) return;
      setDetail(result);
      setTarget(
        technicians.find((item) => item.id !== result.assigneeId)?.id ??
          result.assigneeId,
      );
      setDraft(stored);
      setDirty(false);
      setReviewNotes("");
      reviewAttempt.current = undefined;
      const url = new URL(location.href);
      url.searchParams.set("workOrder", selectedId);
      history.replaceState(null, "", url);
      setLoadError("");
      return result;
    } catch (error) {
      if (generation !== detailGeneration.current) return;
      if (error instanceof ApiError && error.status === 401) return expired();
      if (error instanceof ApiError && [403, 404].includes(error.status)) {
        setDetail(undefined);
        if (stored) {
          const preserved = { ...stored, status: "orphaned" as const };
          try {
            await drafts.put(preserved);
            await reloadSavedDrafts();
            if (generation === detailGeneration.current) setDraft(preserved);
          } catch (storageError) {
            storageFailure(storageError);
            setLoadError(message(error));
            return;
          }
        }
      }
      setLoadError(message(error));
    }
  }, [expired, selectedId, session.user.id, reloadSavedDrafts, storageFailure]);

  const refreshWorkOrder = async () => {
    if (
      !detail ||
      !online ||
      busy ||
      refreshInFlight.current ||
      draft?.status === "queued"
    )
      return;
    if (
      dirty &&
      !window.confirm("Discard unsaved changes and refresh this work order?")
    )
      return;
    refreshInFlight.current = true;
    setBusy(true);
    setPendingAction("Refreshing work order…");
    setNotice(null);
    setLoadError("");
    try {
      const result = await reloadDetail();
      if (!result) return;
      // Renewing the queue window alone does not mean the work record changed.
      const snapshot = (record: WorkOrderDetail) =>
        JSON.stringify({
          ...record,
          envelope: { ceiling: record.envelope.ceiling },
        });
      setWorkOrders((current) =>
        current.map((order) => (order.id === result.id ? result : order)),
      );
      setNotice({
        kind: "success",
        text:
          snapshot(detail) === snapshot(result)
            ? "Work order is up to date."
            : "Work order updated.",
      });
    } finally {
      refreshInFlight.current = false;
      setBusy(false);
    }
  };

  const retryStorage = async () => {
    if (retryingStorage) return;
    setRetryingStorage(true);
    const generation = detailGeneration.current;
    try {
      if (!(await reloadSavedDrafts())) return;
      let stored: InspectionDraft | undefined;
      try {
        stored = selectedId
          ? await drafts.get(drafts.key(session.user.id, selectedId))
          : undefined;
      } catch (error) {
        if (!(error instanceof IncompatibleDraftError)) throw error;
      }
      if (generation !== detailGeneration.current) return;
      // A storage retry must never replace edits or automatically resend a queue.
      if (!dirtyRef.current) setDraft(stored);
      reconnectPending.current = false;
      storageFailed.current = false;
      setStorageReady(true);
      setStorageError("");
    } catch (error) {
      storageFailure(error);
    } finally {
      setRetryingStorage(false);
    }
  };

  useEffect(() => void reloadList(), [reloadList]);
  useEffect(() => {
    void reloadSavedDrafts();
  }, [reloadSavedDrafts]);
  useEffect(() => {
    setDraft(undefined);
    setDetail(undefined);
    setOperation(undefined);
    setConfirmDelete(false);
    setActiveTab("inspection");
    void reloadDetail();
    return () => {
      detailGeneration.current += 1;
    };
  }, [reloadDetail]);
  const loadedDetailId = detail?.id;
  useEffect(() => {
    if (mobileDetail && loadedDetailId) detailHeading.current?.focus();
  }, [mobileDetail, loadedDetailId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    setEnvelopeClock(Date.now());
    if (!detail) return;
    const timer = setInterval(() => setEnvelopeClock(Date.now()), 1000);
    return () => clearInterval(timer);
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

  const hasIncompatibleDraft = incompatibleDrafts.some(
    (item) => item.workOrderId === detail?.id,
  );
  const currentDraft = useMemo<InspectionDraft | undefined>(() => {
    if (!detail || (hasIncompatibleDraft && !draft)) return undefined;
    return (
      draft ?? {
        formatVersion: 3,
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
  }, [detail, draft, session.user.id, hasIncompatibleDraft]);

  const storeDraft = async (next: InspectionDraft, text: string) => {
    if (!validNotes(next.notes)) {
      setNotice({ kind: "error", text: noteLimitMessage });
      return false;
    }
    await drafts.put(next);
    setDraft(next);
    setDirty(false);
    setNotice({ kind: "success", text });
    await reloadSavedDrafts();
    return true;
  };

  const discardOrphaned = async (orphaned: InspectionDraft) => {
    if (!storageReady || busy) return;
    try {
      await drafts.remove(orphaned.key);
      setSavedDrafts((current) =>
        current.filter((item) => item.key !== orphaned.key),
      );
      if (draft?.key === orphaned.key && !dirty) setDraft(undefined);
      setNotice({ kind: "success", text: "Preserved draft discarded." });
    } catch (error) {
      reportError(error);
    }
  };

  const sync = useCallback(
    async (queued = draft) => {
      if (
        queued?.status !== "queued" ||
        !storageReady ||
        !online ||
        submitting.current ||
        !answered(queued.checklist)
      )
        return;
      submitting.current = true;
      setBusy(true);
      setPendingAction("Sending inspection…");
      setOperation((current) => ({
        capability: capabilities.submit,
        local:
          current?.capability === capabilities.submit
            ? current.local
            : undefined,
      }));
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
          observeRequest,
        );
        let localRemovalFailed = false;
        try {
          await drafts.remove(queued.key);
        } catch (error) {
          localRemovalFailed = true;
          storageFailure(error);
        }
        setDraft(undefined);
        setNotice({
          kind: localRemovalFailed ? "error" : "success",
          text: localRemovalFailed
            ? "The server accepted the inspection, but its local copy could not be removed. Refresh to review the submitted record; retrying the unchanged queued copy is safe."
            : result.replayed
              ? "This inspection was already submitted."
              : "Inspection submitted. It is awaiting supervisor review.",
        });
        await reloadList();
        await reloadDetail();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return expired();
        try {
          if (error instanceof ApiError && error.status === 404) {
            const orphaned = { ...queued, status: "orphaned" as const };
            await drafts.put(orphaned);
            setDraft(undefined);
            setDetail(undefined);
            setSavedDrafts((current) => [
              orphaned,
              ...current.filter((item) => item.key !== orphaned.key),
            ]);
            setNotice({
              kind: "error",
              text: "The work order is unavailable. Your local inspection was preserved for review.",
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
        } catch (storageError) {
          storageFailure(storageError);
          setNotice({
            kind: "error",
            text: message(error),
          });
        }
      } finally {
        await reloadSavedDrafts();
        submitting.current = false;
        setBusy(false);
      }
    },
    [
      draft,
      expired,
      online,
      reloadDetail,
      reloadList,
      session.csrfToken,
      observeRequest,
      reloadSavedDrafts,
      storageReady,
      storageFailure,
    ],
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
      editable(detail.status) &&
      detail.envelope.ceiling[capabilities.submit] &&
      Date.parse(detail.envelope.expiresAt) > envelopeClock,
  );
  const reassignAllowed = Boolean(
    detail &&
      editable(detail.status) &&
      detail.envelope.ceiling[capabilities.reassign],
  );
  const deleteAllowed = Boolean(
    detail?.status === "open" && detail.envelope.ceiling[capabilities.delete],
  );
  const hasOpenWorkOrder = workOrders.some((item) => editable(item.status));
  const latestInspection = detail?.inspections[0];
  const allPassed =
    latestInspection &&
    checklistItems.every((item) => latestInspection.checklist[item.key]);
  const reviewAllowed = online && detail?.envelope.ceiling[capabilities.review];

  const saveLocalDraft = async (next: InspectionDraft, text: string) => {
    if (!storageReady || hasIncompatibleDraft || busy) return;
    setBusy(true);
    setPendingAction("Saving draft…");
    setOperation(undefined);
    try {
      await storeDraft(next, text);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };
  const queueInspection = async () => {
    if (
      !currentDraft ||
      !detail ||
      submitting.current ||
      !storageReady ||
      hasIncompatibleDraft
    )
      return;
    if (!validNotes(currentDraft.notes)) {
      setNotice({ kind: "error", text: noteLimitMessage });
      return;
    }
    if (!answered(currentDraft.checklist)) {
      setNotice({
        kind: "error",
        text: "Choose Pass or Fail for every check.",
      });
      return;
    }
    if (
      checklistItems.some(
        (item) => currentDraft.checklist[item.key] === false,
      ) &&
      !currentDraft.notes.trim()
    ) {
      setNotice({
        kind: "error",
        text: "Describe the failed checks in the inspection notes.",
      });
      return;
    }
    if (!queueAllowed || Date.parse(detail.envelope.expiresAt) <= Date.now()) {
      setEnvelopeClock(Date.now());
      setNotice({
        kind: "error",
        text: "Refresh the work order before queuing this inspection.",
      });
      return;
    }
    if (!preflight(capabilities.submit, detail.id)) return;
    submitting.current = true;
    setBusy(true);
    setPendingAction("Queuing inspection…");
    try {
      const queued = { ...currentDraft, status: "queued" as const };
      const saved = await storeDraft(
        queued,
        online
          ? "Inspection ready to send."
          : "Inspection queued until reconnect.",
      );
      submitting.current = false;
      if (saved && online) await sync(queued);
    } catch (error) {
      reportError(error);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const reviewInspection = async (outcome: InspectionReview["outcome"]) => {
    if (!detail || !latestInspection || !reviewAllowed || submitting.current)
      return;
    if (!validNotes(reviewNotes)) {
      setNotice({ kind: "error", text: noteLimitMessage });
      return;
    }
    if (!preflight(capabilities.review, detail.id)) return;
    submitting.current = true;
    setBusy(true);
    setPendingAction("Recording review…");
    const previous = reviewAttempt.current;
    const input =
      previous &&
      previous.inspectionId === latestInspection.id &&
      previous.outcome === outcome &&
      previous.notes === reviewNotes
        ? previous
        : {
            inspectionId: latestInspection.id,
            outcome,
            notes: reviewNotes,
            expectedWorkOrderVersion: detail.workOrderVersion,
            idempotencyKey: crypto.randomUUID(),
          };
    reviewAttempt.current = input;
    try {
      await api.review(detail.id, input, session.csrfToken, observeRequest);
      setNotice({
        kind: "success",
        text:
          outcome === "complete"
            ? "Review recorded. Work order completed."
            : "Corrections requested. The technician can submit a new inspection.",
      });
      await reloadList();
      await reloadDetail();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expired();
      else setNotice({ kind: "error", text: message(error) });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const reassign = async () => {
    if (
      !detail ||
      !reassignAllowed ||
      !online ||
      busy ||
      target === detail.assigneeId
    )
      return;
    if (
      dirty &&
      !window.confirm(
        "Discard unsaved changes and reassign this work order? Saved drafts stay on this device.",
      )
    )
      return;
    if (!preflight(capabilities.reassign, detail.id)) {
      return;
    }
    setBusy(true);
    setPendingAction("Reassigning work order…");
    try {
      await api.reassign(
        detail.id,
        {
          expectedAssignmentEpoch: detail.assignmentEpoch,
          technicianId: target,
        },
        session.csrfToken,
        observeRequest,
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
    if (creating.current || busy) return;
    if (
      dirty &&
      !window.confirm(
        "Discard unsaved changes and add a new work order? Saved drafts stay on this device.",
      )
    )
      return;
    if (
      !online ||
      !createAllowed ||
      !newOrder.equipment.trim() ||
      !newOrder.site.trim()
    ) {
      return;
    }
    if (!preflight(capabilities.create, "work-orders")) {
      return;
    }
    creating.current = true;
    setCreateError("");
    setBusy(true);
    setPendingAction("Adding work order…");
    try {
      const result = await api.createWorkOrder(
        {
          equipment: newOrder.equipment,
          site: newOrder.site,
          technicianId: newOrder.technicianId,
        },
        session.csrfToken,
        observeRequest,
      );
      await reloadList();
      setSelectedId(result.workOrder.id);
      setMobileDetail(true);
      setNewOrder({
        equipment: "",
        site: "",
        technicianId: "user-elena",
      });
      setShowCreate(false);
      setNotice({ kind: "success", text: "Work order added." });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return expired();
      setCreateError(message(error));
    } finally {
      creating.current = false;
      setBusy(false);
    }
  };

  const deleteWorkOrder = async () => {
    if (!detail || !online || !deleteAllowed) return;
    if (!preflight(capabilities.delete, detail.id)) {
      return;
    }
    setBusy(true);
    setPendingAction("Deleting work order…");
    try {
      await api.deleteWorkOrder(
        detail.id,
        {
          expectedWorkOrderVersion: detail.workOrderVersion,
          expectedAssignmentEpoch: detail.assignmentEpoch,
        },
        session.csrfToken,
        observeRequest,
      );
      if (draft && storageReady) {
        try {
          await drafts.remove(draft.key);
        } catch (error) {
          storageFailure(error);
        }
      }
      await reloadSavedDrafts();
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
        busy={busy}
        signOut={async () => {
          if (
            dirty &&
            !window.confirm(
              "Discard unsaved changes and sign out? Saved drafts stay on this device.",
            )
          )
            return;
          try {
            await api.logout(session.csrfToken);
            location.assign("/");
          } catch (error) {
            setNotice({ kind: "error", text: message(error) });
          }
        }}
      />
      <main
        className={`workspace ${mobileDetail ? "show-detail" : "show-list"}`}
      >
        <aside className="work-list" aria-label="Work orders">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Field queue</span>
              <h2 ref={listHeading} tabIndex={-1}>
                Work orders
              </h2>
            </div>
          </div>
          <button
            className="add-order-toggle secondary"
            type="button"
            disabled={!online || !createAllowed || busy}
            aria-haspopup="dialog"
            onClick={() => {
              setCreateError("");
              setShowCreate(true);
            }}
          >
            Add work order
          </button>
          {!online && (
            <p className="help-text">
              Reconnect to add a work order. Saved inspections can still be
              edited offline.
            </p>
          )}
          <div className="queue-filters">
            <label>
              Search work orders
              <input
                type="search"
                value={search}
                placeholder="Equipment, site, or ID"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="filter-row">
              <label>
                Status
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">All statuses</option>
                  {(
                    [
                      "open",
                      "awaiting_review",
                      "changes_requested",
                      "completed",
                    ] as const
                  ).map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Technician
                <select
                  value={assigneeFilter}
                  onChange={(event) => setAssigneeFilter(event.target.value)}
                >
                  <option value="">All technicians</option>
                  {technicians.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="help-text" role="status">
              {filteredOrders.length} of {workOrders.length} loaded work orders
            </p>
          </div>
          <div className="queue-actions">
            <button
              className="secondary"
              type="button"
              disabled={!online || busy}
              onClick={() => void reloadList()}
            >
              Refresh queue
            </button>
          </div>
          {(listError || (loadError && !mobileDetail)) && (
            <p className="notice error" role="alert">
              {listError || loadError}
            </p>
          )}
          <div className="work-items">
            {!workOrders.length &&
              !listError &&
              !listLoading &&
              nextOffset === null && (
                <p className="list-empty">
                  No work orders in the queue. Add one to begin an inspection.
                </p>
              )}
            {(workOrders.length > 0 || nextOffset !== null) &&
              !filteredOrders.length && (
                <p className="list-empty">
                  No matching work orders. Clear the search or filters to see
                  the loaded queue
                  {nextOffset !== null ? ", or load more work orders." : "."}
                </p>
              )}
            {filteredOrders.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`work-item ${selectedId === item.id ? "selected" : ""}`}
                aria-current={selectedId === item.id ? "true" : undefined}
                disabled={busy}
                onClick={() => {
                  if (
                    selectedId !== item.id &&
                    dirty &&
                    !window.confirm(
                      "Discard unsaved changes? Saved drafts stay on this device.",
                    )
                  )
                    return;
                  if (selectedId !== item.id) {
                    setDetail(undefined);
                    setDraft(undefined);
                    setDirty(false);
                  }
                  setSelectedId(item.id);
                  setMobileDetail(true);
                  setNotice(null);
                }}
              >
                <strong>{item.equipment}</strong>
                <span>{item.site}</span>
                <small className="work-order-id">{item.id}</small>
                <small>
                  {item.assigneeName} · {statusLabel(item.status)}
                </small>
              </button>
            ))}
            {nextOffset !== null && (
              <button
                className="secondary"
                type="button"
                disabled={listLoading || !online || busy}
                onClick={() => void loadMore()}
              >
                Load more
              </button>
            )}
            {listLoading && (
              <p className="help-text" role="status">
                Loading work orders…
              </p>
            )}
          </div>
          <SavedDrafts
            items={savedDrafts}
            busy={busy || !storageReady}
            onDiscard={(saved) => void discardOrphaned(saved)}
          />
        </aside>
        <section className="detail-panel">
          <button
            type="button"
            className="secondary back-to-list"
            disabled={busy}
            onClick={() => {
              setMobileDetail(false);
              requestAnimationFrame(() => listHeading.current?.focus());
            }}
          >
            Back to work orders
          </button>
          {detail && (
            <div className="detail-navigation">
              <header className="detail-heading">
                <h2 ref={detailHeading} tabIndex={-1}>
                  {detail.equipment}
                </h2>
              </header>
              <DetailTabs active={activeTab} onChange={setActiveTab} />
            </div>
          )}
          {notice && (
            <p className={`notice ${notice.kind}`} role="status">
              {notice.text}
            </p>
          )}
          {storageError && (
            <section
              className="notice error storage-notice"
              aria-label="Browser storage unavailable"
            >
              <p role="alert">
                {storageError} Saving, queuing, and submitting inspections are
                unavailable until storage works again. Online work orders and
                management actions remain available.
              </p>
              <button
                className="secondary"
                type="button"
                disabled={retryingStorage || busy}
                onClick={() => void retryStorage()}
              >
                {retryingStorage ? "Checking storage…" : "Retry storage"}
              </button>
            </section>
          )}
          {loadError && mobileDetail && (
            <p className="notice error" role="alert">
              {loadError}
            </p>
          )}
          {busy && (
            <p className="help-text" role="status">
              {pendingAction}
            </p>
          )}
          {!detail ? (
            <div className="empty-state">
              <h2>
                {selectedId && !loadError
                  ? "Loading work order…"
                  : "Select a work order"}
              </h2>
              <p>
                {selectedId && !loadError
                  ? "Loading its assignment and inspection history."
                  : "Choose an inspection from the queue."}
              </p>
            </div>
          ) : (
            <>
              <div className="record-tools">
                <div className="record-context">
                  <p>
                    {detail.site} ·{" "}
                    <span className="work-order-id">{detail.id}</span>
                  </p>
                  <p>
                    Assigned to <strong>{detail.assigneeName}</strong>
                  </p>
                </div>
                <span className={`status ${detail.status}`}>
                  {statusLabel(detail.status)}
                </span>
                <span
                  className={`connectivity ${online ? "online" : "offline"}`}
                  title="Browser connectivity; requests can still fail while online."
                >
                  {online ? "Online" : "Offline"}
                </span>
                <div className="record-refresh">
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || !online || draft?.status === "queued"}
                    aria-describedby="refresh-help"
                    onClick={() => void refreshWorkOrder()}
                  >
                    {busy && pendingAction === "Refreshing work order…"
                      ? "Refreshing…"
                      : "Refresh work order"}
                  </button>
                  <p className="help-text" id="refresh-help">
                    {editable(detail.status)
                      ? "Reloads the record and renews the offline queue window."
                      : "Loads the latest inspection and review."}
                  </p>
                </div>
              </div>
              <div
                role="tabpanel"
                id="panel-inspection"
                aria-labelledby="tab-inspection"
                hidden={activeTab !== "inspection"}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI tab panels need keyboard access to their text content.
                tabIndex={0}
              >
                <div className="sync-summary">
                  <strong>
                    {dirty
                      ? "Unsaved changes"
                      : draft?.status === "queued"
                        ? "Queued on this device"
                        : draft
                          ? "Draft saved on this device"
                          : editable(detail.status)
                            ? "Start an inspection"
                            : "Inspection submitted"}
                  </strong>
                  {editable(detail.status) && (
                    <p aria-live="off">
                      {Date.parse(detail.envelope.expiresAt) > envelopeClock
                        ? `You can queue an inspection offline for ${Math.ceil((Date.parse(detail.envelope.expiresAt) - envelopeClock) / 60_000)} more min.`
                        : online
                          ? "Offline queue permission expired. Refresh the work order before queuing a new inspection."
                          : "Offline queue permission expired. Reconnect and refresh before queuing a new inspection."}
                      {!storageReady
                        ? " Saving and sending require working browser storage."
                        : draft?.status === "queued"
                          ? " The server will check access when this inspection is sent."
                          : " You can still edit and save a draft."}
                    </p>
                  )}
                </div>
                {!editable(detail.status) && draft && (
                  <details className="local-draft-copy">
                    <summary>Local draft not submitted</summary>
                    <p>
                      The work order changed before this draft was submitted.
                      Your saved answers and notes are still on this device.
                    </p>
                    <ChecklistSummary checklist={draft.checklist} />
                    <p className="saved-notes">{draft.notes || "No notes."}</p>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy || !storageReady}
                      onClick={async () => {
                        try {
                          await drafts.remove(draft.key);
                          setDraft(undefined);
                        } catch (error) {
                          reportError(error);
                        }
                      }}
                    >
                      Discard saved draft
                    </button>
                  </details>
                )}
                {activeTab === "inspection" && (
                  <InspectionHistory items={detail.inspections.slice(0, 1)} />
                )}
                {detail.status === "awaiting_review" ? (
                  <section className="review-panel">
                    <h3>Supervisor review</h3>
                    <p>
                      Review the submitted answers. Request corrections for
                      failed checks, or complete the work order if all checks
                      pass.
                    </p>
                    <label>
                      Review notes
                      <textarea
                        value={reviewNotes}
                        rows={3}
                        aria-describedby="review-notes-limit"
                        aria-invalid={!validNotes(reviewNotes)}
                        disabled={busy}
                        onChange={(event) => {
                          setReviewNotes(event.target.value);
                          setDirty(true);
                        }}
                      />
                    </label>
                    <p
                      id="review-notes-limit"
                      className={`help-text ${validNotes(reviewNotes) ? "" : "field-error"}`}
                    >
                      {noteBytes(reviewNotes)} / 1,000 UTF-8 bytes
                      {!validNotes(reviewNotes) &&
                        ". Shorten the notes before sending."}
                    </p>
                    {!online && (
                      <p className="help-text">Reconnect to send a review.</p>
                    )}
                    {!reviewNotes.trim() && (
                      <p className="help-text">
                        Add review notes to request corrections.
                      </p>
                    )}
                    {!allPassed && (
                      <p className="help-text">
                        Request corrections for failed checks. All checks must
                        pass before completion.
                      </p>
                    )}
                    <div className="actions inspection-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={!reviewAllowed || busy || !reviewNotes.trim()}
                        onClick={() =>
                          void reviewInspection("request_corrections")
                        }
                      >
                        Request corrections
                      </button>
                      <button
                        type="button"
                        className="primary"
                        disabled={!reviewAllowed || busy || !allPassed}
                        onClick={() => void reviewInspection("complete")}
                      >
                        Complete work order
                      </button>
                    </div>
                  </section>
                ) : detail.status === "completed" ? (
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
                    <p className="checklist-progress" role="status">
                      {
                        checklistItems.filter(
                          (item) =>
                            typeof currentDraft?.checklist[item.key] ===
                            "boolean",
                        ).length
                      }{" "}
                      of {checklistItems.length} checks answered
                    </p>
                    <div className="form-grid">
                      <fieldset
                        disabled={
                          !currentDraft || busy || draft?.status === "queued"
                        }
                      >
                        <legend>Inspection checklist</legend>
                        {checklistItems.map((item) => (
                          <fieldset className="check-result" key={item.key}>
                            <legend>{item.label}</legend>
                            <p className="check-help">{item.help}</p>
                            <div className="result-options">
                              {[true, false].map((passed) => (
                                <label key={String(passed)}>
                                  <input
                                    type="radio"
                                    name={item.key}
                                    checked={
                                      currentDraft?.checklist[item.key] ===
                                      passed
                                    }
                                    onChange={() => {
                                      if (!currentDraft) return;
                                      setDirty(true);
                                      setDraft({
                                        ...currentDraft,
                                        checklist: {
                                          ...currentDraft.checklist,
                                          [item.key]: passed,
                                        },
                                      });
                                    }}
                                  />
                                  {passed ? "Pass" : "Fail"}
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        ))}
                      </fieldset>
                      <label className="notes-field">
                        <span>Inspection notes</span>
                        <textarea
                          rows={3}
                          aria-describedby="inspection-notes-limit"
                          aria-invalid={!validNotes(currentDraft?.notes ?? "")}
                          disabled={
                            !currentDraft || busy || draft?.status === "queued"
                          }
                          value={currentDraft?.notes ?? ""}
                          onChange={(event) => {
                            if (!currentDraft) return;
                            setDirty(true);
                            setDraft({
                              ...currentDraft,
                              notes: event.target.value,
                            });
                          }}
                          placeholder="Describe what you found"
                        />
                        <span
                          id="inspection-notes-limit"
                          className={`help-text ${validNotes(currentDraft?.notes ?? "") ? "" : "field-error"}`}
                        >
                          Describe any failed checks.{" "}
                          {noteBytes(currentDraft?.notes ?? "")} / 1,000 UTF-8
                          bytes
                          {!validNotes(currentDraft?.notes ?? "") &&
                            ". Shorten the notes before saving or sending."}
                        </span>
                      </label>
                    </div>
                    <div className="actions inspection-actions">
                      {draft?.status === "queued" && (
                        <button
                          className="secondary"
                          type="button"
                          disabled={
                            busy || !storageReady || hasIncompatibleDraft
                          }
                          onClick={() =>
                            void saveLocalDraft(
                              {
                                ...draft,
                                status: "draft",
                                idempotencyKey: crypto.randomUUID(),
                              },
                              "Returned to editing. Submit again when ready.",
                            )
                          }
                        >
                          Return to editing
                        </button>
                      )}
                      {draft &&
                        draft.expectedWorkOrderVersion !==
                          detail.workOrderVersion && (
                          <div className="version-conflict">
                            <p className="help-text">
                              This draft uses work v
                              {draft.expectedWorkOrderVersion}. The current
                              record is v{detail.workOrderVersion}. Review the
                              record before updating your draft.
                            </p>
                            <button
                              className="secondary"
                              type="button"
                              disabled={
                                busy ||
                                !online ||
                                !storageReady ||
                                hasIncompatibleDraft
                              }
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Keep these answers and start a new submission using work version ${detail.workOrderVersion}?`,
                                  )
                                )
                                  void saveLocalDraft(
                                    {
                                      ...draft,
                                      status: "draft",
                                      expectedWorkOrderVersion:
                                        detail.workOrderVersion,
                                      idempotencyKey: crypto.randomUUID(),
                                    },
                                    "Draft updated to the current work order version. Review the answers before submitting.",
                                  );
                              }}
                            >
                              Use current work order version
                            </button>
                          </div>
                        )}
                      <button
                        className="secondary"
                        type="button"
                        disabled={
                          !currentDraft ||
                          busy ||
                          !storageReady ||
                          hasIncompatibleDraft ||
                          draft?.status === "queued"
                        }
                        onClick={() =>
                          currentDraft &&
                          void saveLocalDraft(
                            { ...currentDraft, status: "draft" },
                            "Draft saved on this device.",
                          )
                        }
                      >
                        {busy && pendingAction === "Saving draft…"
                          ? "Saving…"
                          : "Save draft"}
                      </button>
                      <button
                        className="primary"
                        type="button"
                        disabled={
                          !currentDraft ||
                          !storageReady ||
                          hasIncompatibleDraft ||
                          busy ||
                          (draft?.status === "queued" ? !online : !queueAllowed)
                        }
                        onClick={() => {
                          if (draft?.status === "queued") {
                            void sync(draft);
                            return;
                          }
                          void queueInspection();
                        }}
                      >
                        {busy &&
                        (pendingAction === "Sending inspection…" ||
                          pendingAction === "Queuing inspection…")
                          ? pendingAction
                          : draft?.status === "queued"
                            ? "Retry sending"
                            : online
                              ? "Submit inspection"
                              : "Queue inspection"}
                      </button>
                    </div>
                    {!online && (
                      <p className="help-text">
                        Reconnect to refresh the work order or send a queued
                        inspection.
                      </p>
                    )}
                  </>
                )}
              </div>
              <div
                role="tabpanel"
                id="panel-activity"
                aria-labelledby="tab-activity"
                hidden={activeTab !== "activity"}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI tab panels need keyboard access to their text content.
                tabIndex={0}
              >
                <h3>Activity</h3>
                <p className="help-text">
                  Submissions, reviews, and assignment changes, newest first
                  within each list.
                </p>
                {activeTab === "activity" && (
                  <InspectionHistory items={detail.inspections} />
                )}
                {!detail.inspections.length && (
                  <p className="help-text">No inspections submitted yet.</p>
                )}
                <section
                  className="assignment-history"
                  aria-label="Assignment history"
                >
                  <h3>Assignment history</h3>
                  {detail.assignmentHistory.length ? (
                    <ol>
                      {detail.assignmentHistory.map((change) => (
                        <li key={change.assignmentEpoch}>
                          <strong>
                            {change.previousAssignee} → {change.newAssignee}
                          </strong>
                          <span>
                            {change.changedBy} ·{" "}
                            <time dateTime={change.changedAt}>
                              {new Date(change.changedAt).toLocaleString()}
                            </time>
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="help-text">No reassignment recorded.</p>
                  )}
                </section>
                <TechnicalDetails
                  key={detail.id}
                  workOrder={detail}
                  operation={operation}
                />
              </div>
              <div
                role="tabpanel"
                id="panel-manage"
                aria-labelledby="tab-manage"
                hidden={activeTab !== "manage"}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI tab panels need keyboard access to their text content.
                tabIndex={0}
              >
                <section
                  className="assignment-management"
                  aria-label="Assignment management"
                >
                  <h3>Assignment management</h3>
                  <p className="help-text">
                    Reassign this work or delete an open order before its first
                    inspection.
                  </p>
                  <div className="reassign-row">
                    <label>
                      <span>Assign technician</span>
                      <select
                        value={target}
                        disabled={busy || !online || !reassignAllowed}
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
                      {busy && pendingAction === "Reassigning work order…"
                        ? "Reassigning…"
                        : "Reassign"}
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
                  {!online ? (
                    <p className="help-text">
                      Reconnect to change the assignment or delete this order.
                    </p>
                  ) : (
                    target === detail.assigneeId && (
                      <p className="help-text">
                        Choose a different technician to reassign this work
                        order.
                      </p>
                    )
                  )}
                  {detail.status !== "open" && (
                    <p className="help-text">
                      An order with a submitted inspection cannot be deleted.
                    </p>
                  )}
                  {!editable(detail.status) && (
                    <p className="help-text">
                      Reassignment is available while an order is open or needs
                      corrections.
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
          <div className="mobile-recovery">
            <SavedDrafts
              items={savedDrafts}
              busy={busy || !storageReady}
              onDiscard={(saved) => void discardOrphaned(saved)}
            />
          </div>
          {incompatibleDrafts.map((saved) => (
            <section className="orphaned-draft" key={saved.key}>
              <div>
                <h3>Saved checklist needs new answers</h3>
                <p>
                  {saved.workOrderId}: copy any notes you need, then discard
                  this draft and fill in the current checklist.
                </p>
                <p>{saved.notes || "No saved notes."}</p>
              </div>
              <button
                type="button"
                className="secondary"
                disabled={busy || !storageReady}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Discard this saved draft? Its notes and answers will be removed from this browser.",
                    )
                  )
                    return;
                  try {
                    await drafts.remove(saved.key);
                    setIncompatibleDrafts((current) =>
                      current.filter((item) => item.key !== saved.key),
                    );
                  } catch (error) {
                    reportError(error);
                  }
                }}
              >
                Discard old draft
              </button>
            </section>
          ))}
          {savedDrafts
            .filter((saved) => saved.status === "orphaned")
            .map((orphaned) => {
              return (
                <section className="orphaned-draft" key={orphaned.key}>
                  <div>
                    <span className="eyebrow">Unavailable work order</span>
                    <h2>Preserved inspection draft</h2>
                    <p>
                      {orphaned.workOrderId} is unavailable. Review this local
                      copy, then discard it when it is no longer needed.
                    </p>
                    <ChecklistSummary checklist={orphaned.checklist} />
                    <p className="saved-notes">
                      {orphaned.notes || "No notes."}
                    </p>
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || !storageReady}
                    onClick={() => void discardOrphaned(orphaned)}
                  >
                    Discard draft
                  </button>
                </section>
              );
            })}
        </section>
      </main>
      {showCreate && (
        <CreationDialog
          value={newOrder}
          busy={busy}
          online={online}
          error={createError}
          onChange={setNewOrder}
          onSubmit={() => void createWorkOrder()}
          onCancel={() => {
            if (
              (newOrder.equipment ||
                newOrder.site ||
                newOrder.technicianId !== "user-elena") &&
              !window.confirm("Discard the new work order entries?")
            )
              return;
            setShowCreate(false);
            setNewOrder({
              equipment: "",
              site: "",
              technicianId: "user-elena",
            });
          }}
        />
      )}
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
