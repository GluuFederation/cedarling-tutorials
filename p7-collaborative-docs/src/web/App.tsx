import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DocumentDetail,
  DocumentRole,
  DocumentSummary,
  Session,
} from "../shared/types.ts";
import { documentEventKinds, streamReadyEvent } from "../shared/types.ts";
import { ApiError, api } from "./api.ts";
import { Collaboration, type CollaborationTab } from "./Collaboration.tsx";
import { CollaborationPanel } from "./CollaborationPanel.tsx";
import { CreateDocument } from "./CreateDocument.tsx";
import { DocumentEditor } from "./DocumentEditor.tsx";
import { BrandRail, Footer, Login } from "./Shell.tsx";

type Notice = { kind: "success" | "error"; text: string } | null;
type SessionState =
  | { kind: "loading" }
  | { kind: "authenticated"; session: Session }
  | { kind: "unauthenticated"; expired: boolean }
  | { kind: "error" };

function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "state_conflict") {
      return "The document changed. Refresh it before trying again.";
    }
    if (error.code === "owner_is_immutable") {
      return "The document owner cannot be changed or removed.";
    }
    if (error.code === "forbidden") {
      return "The current identity cannot perform this action.";
    }
    if (error.code === "authentication_required")
      return "Your session expired.";
    if (error.code === "service_unavailable") {
      return "Service unavailable. Try again.";
    }
  }
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function ServiceFailure({ retry }: Readonly<{ retry: () => void }>) {
  return (
    <div className="app-shell">
      <BrandRail />
      <main className="login-main">
        <section className="service-state">
          <h2>Application unavailable</h2>
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
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [createAllowed, setCreateAllowed] = useState(false);
  const [selectedId, setSelectedId] = useState(
    () => new URLSearchParams(location.search).get("document") ?? "",
  );
  const [detail, setDetail] = useState<DocumentDetail>();
  const detailRef = useRef<DocumentDetail | undefined>(undefined);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const detailRequest = useRef(0);
  const [mobileDetail, setMobileDetail] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [remoteUpdate, setRemoteUpdate] = useState(false);
  const [streamState, setStreamState] = useState<
    "connecting" | "live" | "reconnecting"
  >("connecting");
  const [showCreate, setShowCreate] = useState(false);
  const [newDocument, setNewDocument] = useState({ title: "", content: "" });
  const [comment, setComment] = useState("");
  const [commentIdempotencyKey, setCommentIdempotencyKey] = useState<string>(
    () => crypto.randomUUID(),
  );
  const [candidate, setCandidate] = useState("");
  const [role, setRole] = useState<Exclude<DocumentRole, "owner">>("editor");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [collaborationOpen, setCollaborationOpen] = useState(
    () => matchMedia("(min-width: 1280px)").matches,
  );
  const [collaborationTab, setCollaborationTab] =
    useState<CollaborationTab>("comments");
  const closeCollaboration = useCallback(() => setCollaborationOpen(false), []);
  const unsavedRef = useRef(false);
  unsavedRef.current =
    dirty ||
    Boolean(
      comment.trim() || newDocument.title.trim() || newDocument.content.trim(),
    );

  useEffect(() => {
    if (notice?.kind !== "success") return;
    const timer = setTimeout(() => setNotice(null), 5_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const loadList = useCallback(async () => {
    try {
      const result = await api.documents();
      setDocuments(result.documents);
      setCreateAllowed(result.createAllowed);
      setSelectedId((current) =>
        current && result.documents.some((item) => item.id === current)
          ? current
          : (result.documents[0]?.id ?? ""),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return expired();
      if (error instanceof ApiError && error.status === 404) {
        setDetail(undefined);
      }
      setNotice({ kind: "error", text: message(error) });
    }
  }, [expired]);

  const loadDetail = useCallback(
    async (discardChanges = false) => {
      const request = ++detailRequest.current;
      if (!selectedId) {
        setDetail(undefined);
        return;
      }
      try {
        const next = await api.document(selectedId);
        if (
          request !== detailRequest.current ||
          selectedId !== selectedIdRef.current
        )
          return;
        const preserveEdits =
          dirtyRef.current &&
          !discardChanges &&
          detailRef.current?.id === selectedId;
        // Keep the version that these edits were based on until the user refreshes.
        const current =
          preserveEdits && detailRef.current
            ? { ...next, documentVersion: detailRef.current.documentVersion }
            : next;
        setDetail(current);
        detailRef.current = current;
        if (!preserveEdits) {
          setTitle(next.title);
          setContent(next.content);
          setDirty(false);
          dirtyRef.current = false;
        }
        setCandidate(
          next.candidates.find(
            (user) => !next.members.some((member) => member.userId === user.id),
          )?.id ?? "",
        );
        setRemoteUpdate(
          preserveEdits && next.documentVersion !== current.documentVersion,
        );
        const url = new URL(location.href);
        url.searchParams.set("document", selectedId);
        history.replaceState(null, "", url);
      } catch (error) {
        if (
          request !== detailRequest.current ||
          selectedId !== selectedIdRef.current
        )
          return;
        if (error instanceof ApiError && error.status === 401) return expired();
        setNotice({ kind: "error", text: message(error) });
      }
    },
    [expired, selectedId],
  );

  useEffect(() => void loadList(), [loadList]);
  useEffect(() => void loadDetail(), [loadDetail]);
  useEffect(() => {
    if (!selectedId) return;
    let source: EventSource | undefined;
    const refresh = () => {
      void loadList();
      void loadDetail();
    };
    const disconnect = () => {
      source?.close();
      setStreamState("reconnecting");
    };
    const connect = () => {
      source?.close();
      if (!navigator.onLine) return disconnect();
      setStreamState("connecting");
      source = new EventSource(
        `/api/documents/${encodeURIComponent(selectedId)}/events`,
      );
      source.addEventListener(streamReadyEvent, () => {
        setStreamState("live");
        refresh();
      });
      for (const event of Object.values(documentEventKinds))
        source.addEventListener(event, refresh);
      source.onerror = () => setStreamState("reconnecting");
    };
    connect();
    window.addEventListener("offline", disconnect);
    window.addEventListener("online", connect);
    return () => {
      source?.close();
      window.removeEventListener("offline", disconnect);
      window.removeEventListener("online", connect);
    };
  }, [loadDetail, loadList, selectedId]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!unsavedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const mayDiscard = () =>
    !unsavedRef.current ||
    window.confirm(
      "Leave your unsaved changes? This includes document text, comments, and new documents.",
    );
  const selectDocument = (id: string) => {
    if (id !== selectedId && !mayDiscard()) return;
    if (id !== selectedId) {
      dirtyRef.current = false;
      setDirty(false);
      setDetail(undefined);
      setComment("");
      setNotice(null);
    }
    setSelectedId(id);
    setMobileDetail(true);
  };
  useEffect(() => {
    if (
      mobileDetail &&
      detail?.id === selectedId &&
      window.matchMedia("(max-width: 980px)").matches
    )
      headingRef.current?.focus();
  }, [mobileDetail, selectedId, detail?.id]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expired();
      else setNotice({ kind: "error", text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!detail) return;
    void run(async () => {
      const next = await api.updateDocument(
        detail.id,
        { title, content, expectedDocumentVersion: detail.documentVersion },
        session.csrfToken,
      );
      detailRequest.current += 1;
      setDetail(next);
      detailRef.current = next;
      setTitle(next.title);
      setContent(next.content);
      setDirty(false);
      dirtyRef.current = false;
      setRemoteUpdate(false);
      setNotice({ kind: "success", text: "Document saved." });
      await loadList();
    });
  };

  const create = () =>
    void run(async () => {
      if (
        (dirtyRef.current || comment.trim()) &&
        !window.confirm("Discard your unsaved document changes and comment?")
      )
        return;
      const result = await api.createDocument(newDocument, session.csrfToken);
      setNewDocument({ title: "", content: "" });
      setShowCreate(false);
      await loadList();
      setSelectedId(result.document.id);
      setComment("");
      dirtyRef.current = false;
      setDirty(false);
      setMobileDetail(true);
      setNotice({ kind: "success", text: "Document created." });
    });

  const addComment = () => {
    if (!detail) return;
    void run(async () => {
      await api.addComment(
        detail.id,
        { body: comment, idempotencyKey: commentIdempotencyKey },
        session.csrfToken,
      );
      setComment("");
      setCommentIdempotencyKey(crypto.randomUUID());
      await loadDetail();
      setNotice({ kind: "success", text: "Comment added." });
    });
  };

  const changeAccess = (
    userId: string,
    nextRole: Exclude<DocumentRole, "owner">,
  ) => {
    if (!detail) return;
    void run(async () => {
      await api.setAccess(
        detail.id,
        userId,
        { role: nextRole, expectedAccessVersion: detail.accessVersion },
        session.csrfToken,
      );
      await loadDetail();
      setNotice({ kind: "success", text: "Access updated." });
    });
  };

  const removeAccess = (userId: string) => {
    if (!detail) return;
    void run(async () => {
      await api.removeAccess(
        detail.id,
        userId,
        { expectedAccessVersion: detail.accessVersion },
        session.csrfToken,
      );
      await loadDetail();
      setNotice({ kind: "success", text: "Access removed." });
    });
  };

  return (
    <div className="app-shell">
      <BrandRail
        session={session}
        signOut={() => {
          if (mayDiscard())
            void api.logout(session.csrfToken).finally(() => location.reload());
        }}
      />
      <main
        className={`workspace ${mobileDetail ? "show-detail" : "show-list"}`}
      >
        <aside className="document-rail">
          <div className="panel-heading">
            <div>
              <h2>Documents</h2>
            </div>
          </div>
          <div className="document-list" ref={listRef}>
            {documents.map((document) => (
              <button
                key={document.id}
                type="button"
                className={`document-item ${document.id === selectedId ? "selected" : ""}`}
                aria-current={document.id === selectedId ? "true" : undefined}
                disabled={busy}
                onClick={() => selectDocument(document.id)}
              >
                <strong>{document.title}</strong>
                <span>
                  {document.role ?? "No membership"} · v
                  {document.documentVersion}
                </span>
              </button>
            ))}
          </div>
          {createAllowed && (
            <button
              className="secondary full"
              type="button"
              onClick={() => setShowCreate((current) => !current)}
            >
              New document
            </button>
          )}
        </aside>
        <section className="document-panel">
          <button
            className="secondary mobile-back"
            type="button"
            onClick={() => {
              setMobileDetail(false);
              requestAnimationFrame(() =>
                listRef.current
                  ?.querySelector<HTMLButtonElement>('[aria-current="true"]')
                  ?.focus(),
              );
            }}
          >
            Back to documents
          </button>
          {notice && (
            <p className={`notice ${notice.kind}`} role="status">
              {notice.text}
            </p>
          )}
          {!detail ? (
            <div className="empty-state">
              <h2>Select a document</h2>
              <p>Open a document to edit, comment, or manage access.</p>
            </div>
          ) : (
            <>
              <div className="detail-heading">
                <div>
                  <h2 ref={headingRef} tabIndex={-1}>
                    {detail.title}
                  </h2>
                  <p className="document-membership">
                    Your access: {detail.role ?? "No membership"}
                  </p>
                </div>
                <div className="document-tools">
                  <span className={`connectivity ${streamState}`}>
                    {streamState}
                  </span>
                  <span className="save-state" role="status">
                    {busy
                      ? "Working…"
                      : dirty
                        ? "Unsaved changes"
                        : "All changes saved"}
                  </span>
                  <button
                    type="button"
                    aria-expanded={
                      collaborationOpen && collaborationTab === "comments"
                    }
                    onClick={() => {
                      setCollaborationTab("comments");
                      setCollaborationOpen(true);
                    }}
                  >
                    Comments ({detail.comments.length})
                  </button>
                  <button
                    type="button"
                    aria-expanded={
                      collaborationOpen && collaborationTab === "access"
                    }
                    onClick={() => {
                      setCollaborationTab("access");
                      setCollaborationOpen(true);
                    }}
                  >
                    Access ({detail.members.length})
                  </button>
                </div>
              </div>
              {remoteUpdate && (
                <div className="notice warning">
                  A newer version is available.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      if (mayDiscard()) void loadDetail(true);
                    }}
                  >
                    Refresh
                  </button>
                </div>
              )}
              <div
                className={`document-grid ${collaborationOpen ? "with-collaboration" : ""}`}
              >
                <DocumentEditor
                  detail={detail}
                  title={title}
                  content={content}
                  busy={busy}
                  dirty={dirty}
                  onTitle={(value) => {
                    setTitle(value);
                    setDirty(true);
                    dirtyRef.current = true;
                  }}
                  onContent={(value) => {
                    setContent(value);
                    setDirty(true);
                    dirtyRef.current = true;
                  }}
                  save={save}
                />
                <CollaborationPanel
                  open={collaborationOpen}
                  tab={collaborationTab}
                  setTab={setCollaborationTab}
                  detail={detail}
                  close={closeCollaboration}
                >
                  <Collaboration
                    detail={detail}
                    busy={busy}
                    tab={collaborationTab}
                    comment={comment}
                    setComment={setComment}
                    setCommentIdempotencyKey={setCommentIdempotencyKey}
                    addComment={addComment}
                    changeAccess={changeAccess}
                    removeAccess={removeAccess}
                    candidate={candidate}
                    setCandidate={setCandidate}
                    role={role}
                    setRole={setRole}
                  />
                </CollaborationPanel>
              </div>
            </>
          )}
        </section>
      </main>
      <CreateDocument
        open={showCreate}
        close={() => setShowCreate(false)}
        busy={busy}
        newDocument={newDocument}
        setNewDocument={setNewDocument}
        create={create}
      />
      <Footer />
    </div>
  );
}

export function App() {
  const [state, setState] = useState<SessionState>({ kind: "loading" });
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "authenticated", session: await api.session() });
    } catch (error) {
      setState(
        error instanceof ApiError && error.status === 401
          ? { kind: "unauthenticated", expired: false }
          : { kind: "error" },
      );
    }
  }, []);
  useEffect(() => void load(), [load]);
  if (state.kind === "loading")
    return <div className="loading">Loading documents…</div>;
  if (state.kind === "error")
    return <ServiceFailure retry={() => void load()} />;
  if (state.kind === "unauthenticated")
    return <Login expired={state.expired} />;
  return (
    <Workspace
      session={state.session}
      expired={() => setState({ kind: "unauthenticated", expired: true })}
    />
  );
}
