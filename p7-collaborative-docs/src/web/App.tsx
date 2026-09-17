import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tutorialUsers } from "../shared/catalog.ts";
import type {
  DocumentDetail,
  DocumentRole,
  DocumentSummary,
  Session,
} from "../shared/types.ts";
import { documentEventKinds, streamReadyEvent } from "../shared/types.ts";
import { ApiError, api } from "./api.ts";
import cedarlingMark from "./assets/cedarling-mark.png";
import cedarlingWordmark from "./assets/cedarling-wordmark-dark.webp";

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

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("");
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
        <h1>P7 - Securing Real-Time Collaborative Documents with Cedarling</h1>
        <p>Authorize document, comment, sharing, and live-update boundaries.</p>
      </div>
      {session ? (
        <details className="account-menu">
          <summary className="rail-identity" aria-label="Open account menu">
            <span className="identity-avatar" aria-hidden="true">
              {initials(session.user.name)}
            </span>
            <span className="identity-copy">
              <strong>{session.user.name}</strong>
              <small>Collaborator</small>
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
  const profiles: Record<string, string> = {
    maya: "Document owner",
    noah: "Document editor",
    lena: "Comment-only collaborator",
  };
  return (
    <div className="app-shell">
      <BrandRail />
      <main className="login-main">
        <section className="login-panel" aria-labelledby="login-title">
          <h2 id="login-title">Choose a tutorial identity</h2>
          <p>Compare collaboration permissions on the same live document.</p>
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
                  {initials(user.name)}
                </span>
                <span>
                  <strong>{user.name}</strong>
                  <small>{profiles[user.subject]}</small>
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
  const [commentIdempotencyKey, setCommentIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [candidate, setCandidate] = useState("");
  const [role, setRole] = useState<Exclude<DocumentRole, "owner">>("editor");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

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

  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(undefined);
      return;
    }
    try {
      const next = await api.document(selectedId);
      setDetail(next);
      setTitle(next.title);
      setContent(next.content);
      setCandidate(
        next.candidates.find(
          (user) => !next.members.some((member) => member.userId === user.id),
        )?.id ?? "",
      );
      setDirty(false);
      dirtyRef.current = false;
      setRemoteUpdate(false);
      const url = new URL(location.href);
      url.searchParams.set("document", selectedId);
      history.replaceState(null, "", url);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return expired();
      setNotice({ kind: "error", text: message(error) });
    }
  }, [expired, selectedId]);

  useEffect(() => void loadList(), [loadList]);
  useEffect(() => void loadDetail(), [loadDetail]);
  useEffect(() => {
    if (!selectedId) return;
    setStreamState("connecting");
    const source = new EventSource(
      `/api/documents/${encodeURIComponent(selectedId)}/events`,
    );
    const refresh = () => {
      void loadList();
      if (dirtyRef.current) setRemoteUpdate(true);
      else void loadDetail();
    };
    source.addEventListener(streamReadyEvent, () => setStreamState("live"));
    for (const event of Object.values(documentEventKinds)) {
      source.addEventListener(event, refresh);
    }
    source.onerror = () => setStreamState("reconnecting");
    return () => source.close();
  }, [loadDetail, loadList, selectedId]);

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
      setDetail(next);
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
      const result = await api.createDocument(newDocument, session.csrfToken);
      setNewDocument({ title: "", content: "" });
      setShowCreate(false);
      await loadList();
      setSelectedId(result.document.id);
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
      const next = await api.setAccess(
        detail.id,
        userId,
        { role: nextRole, expectedAccessVersion: detail.accessVersion },
        session.csrfToken,
      );
      setDetail(next);
      setNotice({ kind: "success", text: "Access updated." });
    });
  };

  const removeAccess = (userId: string) => {
    if (!detail) return;
    void run(async () => {
      const next = await api.removeAccess(
        detail.id,
        userId,
        { expectedAccessVersion: detail.accessVersion },
        session.csrfToken,
      );
      setDetail(next);
      setNotice({ kind: "success", text: "Access removed." });
    });
  };

  const unusedCandidates = useMemo(
    () =>
      detail?.candidates.filter(
        (user) => !detail.members.some((member) => member.userId === user.id),
      ) ?? [],
    [detail],
  );

  return (
    <div className="app-shell">
      <BrandRail
        session={session}
        signOut={() =>
          void api.logout(session.csrfToken).finally(() => location.reload())
        }
      />
      <main className="workspace">
        <aside className="document-rail">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Documents</span>
              <h2>Workspace</h2>
            </div>
            <span className={`connectivity ${streamState}`}>{streamState}</span>
          </div>
          <div className="document-list">
            {documents.map((document) => (
              <button
                key={document.id}
                type="button"
                className={`document-item ${document.id === selectedId ? "selected" : ""}`}
                onClick={() => setSelectedId(document.id)}
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
              {showCreate ? "Cancel" : "New document"}
            </button>
          )}
          {showCreate && (
            <form
              className="compact-form"
              onSubmit={(event) => {
                event.preventDefault();
                create();
              }}
            >
              <label>
                Title
                <input
                  required
                  maxLength={100}
                  value={newDocument.title}
                  onChange={(event) =>
                    setNewDocument((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Starting text
                <textarea
                  required
                  maxLength={20_000}
                  rows={4}
                  value={newDocument.content}
                  onChange={(event) =>
                    setNewDocument((current) => ({
                      ...current,
                      content: event.target.value,
                    }))
                  }
                />
              </label>
              <button className="primary" disabled={busy} type="submit">
                Create
              </button>
            </form>
          )}
        </aside>
        <section className="document-panel">
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
                  <span className="eyebrow">
                    {detail.role ?? "No membership"}
                  </span>
                  <h2>{detail.title}</h2>
                </div>
                <span className="version">
                  Document v{detail.documentVersion}
                </span>
              </div>
              {remoteUpdate && (
                <div className="notice warning">
                  A newer version is available.{" "}
                  <button type="button" onClick={() => void loadDetail()}>
                    Refresh
                  </button>
                </div>
              )}
              <div className="document-grid">
                <section className="editor-card">
                  <label>
                    Title
                    <input
                      maxLength={100}
                      value={title}
                      onChange={(event) => {
                        setTitle(event.target.value);
                        setDirty(true);
                        dirtyRef.current = true;
                      }}
                    />
                  </label>
                  <label>
                    Document
                    <textarea
                      maxLength={20_000}
                      rows={13}
                      value={content}
                      onChange={(event) => {
                        setContent(event.target.value);
                        setDirty(true);
                        dirtyRef.current = true;
                      }}
                    />
                  </label>
                  <div className="actions">
                    <small>Owner: {detail.ownerName}</small>
                    <button
                      className="primary"
                      type="button"
                      disabled={busy || !dirty || !detail.actions.edit}
                      onClick={save}
                    >
                      Save changes
                    </button>
                  </div>
                </section>
                <aside className="side-stack">
                  <section className="compact-card">
                    <h3>Comments</h3>
                    <div className="comments">
                      {detail.comments.map((item) => (
                        <article key={item.id}>
                          <strong>{item.authorName}</strong>
                          <p>{item.body}</p>
                        </article>
                      ))}
                    </div>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        addComment();
                      }}
                    >
                      <label>
                        Add comment
                        <textarea
                          maxLength={1_000}
                          rows={2}
                          value={comment}
                          onChange={(event) => {
                            setComment(event.target.value);
                            setCommentIdempotencyKey(crypto.randomUUID());
                          }}
                        />
                      </label>
                      <button
                        className="secondary"
                        disabled={
                          busy || !comment.trim() || !detail.actions.comment
                        }
                        type="submit"
                      >
                        Comment
                      </button>
                    </form>
                  </section>
                  <section className="compact-card">
                    <h3>Access</h3>
                    <div className="members">
                      {detail.members.map((member) => (
                        <div key={member.userId} className="member">
                          <span>
                            <strong>{member.name}</strong>
                            <small>{member.role}</small>
                          </span>
                          {member.role !== "owner" && (
                            <span className="member-actions">
                              <select
                                aria-label={`Role for ${member.name}`}
                                value={member.role}
                                disabled={busy || !detail.actions.manageAccess}
                                onChange={(event) =>
                                  changeAccess(
                                    member.userId,
                                    event.target.value as Exclude<
                                      DocumentRole,
                                      "owner"
                                    >,
                                  )
                                }
                              >
                                <option value="editor">Editor</option>
                                <option value="commenter">Commenter</option>
                              </select>
                              <button
                                className="text-danger"
                                type="button"
                                disabled={busy || !detail.actions.manageAccess}
                                onClick={() => removeAccess(member.userId)}
                              >
                                Remove
                              </button>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    {unusedCandidates.length > 0 && (
                      <div className="share-row">
                        <select
                          aria-label="Collaborator"
                          value={candidate}
                          onChange={(event) => setCandidate(event.target.value)}
                        >
                          <option value="">Choose collaborator</option>
                          {unusedCandidates.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Access role"
                          value={role}
                          onChange={(event) =>
                            setRole(
                              event.target.value as Exclude<
                                DocumentRole,
                                "owner"
                              >,
                            )
                          }
                        >
                          <option value="editor">Editor</option>
                          <option value="commenter">Commenter</option>
                        </select>
                        <button
                          className="secondary"
                          type="button"
                          disabled={
                            busy || !candidate || !detail.actions.manageAccess
                          }
                          onClick={() => changeAccess(candidate, role)}
                        >
                          Share
                        </button>
                      </div>
                    )}
                  </section>
                </aside>
              </div>
            </>
          )}
        </section>
      </main>
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
    return <div className="loading">Loading CedarDocs…</div>;
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
