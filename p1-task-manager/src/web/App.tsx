import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Plus,
  WarningCircle,
  X,
} from "./Icons";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import cedarlingMark from "./assets/cedarling-mark.png";
import cedarlingWordmark from "./assets/cedarling-wordmark-dark.webp";
import { api, ApiError } from "./api";
import { logTaskListAuthorization } from "./authorization-trace";
import { friendlyError } from "./errors";
import { Modal } from "./Modal";
import type { Session, Task } from "./types";

const tutorialAccounts = [
  {
    id: "alex",
    initials: "AM",
    name: "Alex Morgan",
    context: "Contributor · Tenant A",
  },
  {
    id: "mina",
    initials: "MO",
    name: "Mina Okafor",
    context: "Owner · Tenant A",
  },
  {
    id: "sam",
    initials: "SR",
    name: "Sam Rivera",
    context: "External user · Tenant B",
  },
] as const;

const userNames: Record<string, string> = {
  "user-alex": "Alex Morgan",
  "user-mina": "Mina Okafor",
  "user-sam": "Sam Rivera",
};

type Overlay = "create" | "delete" | null;
type LoadState = "loading" | "ready" | "error";
type Notice = { kind: "success" | "error"; text: string } | null;

function BrandRail({
  session,
  onSwitchAccount,
}: Readonly<{
  session?: Session;
  onSwitchAccount?: () => void;
}>) {
  return (
    <header className="brand-rail">
      <picture className="brand-lockup">
        <source media="(max-width: 760px)" srcSet={cedarlingMark} />
        <img src={cedarlingWordmark} alt="Cedarling" />
      </picture>
      <div className="topbar-copy">
        <h1>P1 - Protecting a Node.js REST API with Cedarling</h1>
        <p>Protect every task effect with trusted server facts.</p>
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
            <button type="button" onClick={onSwitchAccount}>
              Change account
            </button>
            <button type="button" onClick={onSwitchAccount}>
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

function ProgramFooter() {
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
    <div className="login-shell">
      <BrandRail />
      <main className="landing">
        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-heading">
            <h2 id="login-title">Choose a tutorial identity</h2>
            <p>Compare the same workflow across three identities.</p>
          </div>
          {expired && (
            <p className="inline-feedback" role="alert">
              Session expired. Choose an identity again.
            </p>
          )}
          <nav className="account-choices" aria-label="Tutorial identities">
            {tutorialAccounts.map((account) => (
              <a
                className="account-choice"
                href={`/auth/login?login_hint=${account.id}`}
                key={account.id}
              >
                <span className="account-avatar" aria-hidden="true">
                  {account.initials}
                </span>
                <span className="account-copy">
                  <strong>{account.name}</strong>
                  <small>{account.context}</small>
                </span>
                <ArrowRight aria-hidden="true" size={20} weight="bold" />
              </a>
            ))}
          </nav>
        </section>
      </main>
      <ProgramFooter />
    </div>
  );
}

function ServiceFailure({ retry }: Readonly<{ retry: () => void }>) {
  return (
    <div className="login-shell">
      <BrandRail />
      <main className="landing">
        <section className="service-state" aria-labelledby="service-title">
          <WarningCircle aria-hidden="true" size={28} />
          <h2 id="service-title">Application unavailable</h2>
          <p>The session service could not be reached.</p>
          <button className="primary" onClick={retry} type="button">
            Retry
          </button>
        </section>
      </main>
      <ProgramFooter />
    </div>
  );
}

function Workspace({
  session,
  onSessionExpired,
}: Readonly<{ session: Session; onSessionExpired: () => void }>) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [listState, setListState] = useState<LoadState>("loading");
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [selected, setSelected] = useState<Task>();
  const [detailState, setDetailState] = useState<LoadState>("loading");
  const [detailError, setDetailError] = useState("");
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [editForm, setEditForm] = useState({ title: "", description: "" });
  const [createForm, setCreateForm] = useState({ title: "", description: "" });
  const [createError, setCreateError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);

  const nextAssignee =
    selected?.assigneeId === "user-mina"
      ? { id: "user-alex", name: "Alex" }
      : { id: "user-mina", name: "Mina" };

  const replaceTask = useCallback((task: Task) => {
    setTasks((current) => {
      const exists = current.some((item) => item.id === task.id);
      return exists
        ? current.map((item) => (item.id === task.id ? task : item))
        : [task, ...current];
    });
    setSelected((current) => (current?.id === task.id ? task : current));
  }, []);

  const loadTasks = useCallback(async () => {
    setListState("loading");
    setListError("");
    try {
      const result = await api.tasks();
      logTaskListAuthorization({
        principalId: session.user.id,
        tenantId: session.user.tenantId,
      });
      setTasks(result.tasks);
      setSelectedId((current) =>
        current && result.tasks.some((task) => task.id === current)
          ? current
          : result.tasks[0]?.id,
      );
      setListState("ready");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setListError(friendlyError(error));
      setListState("error");
    }
  }, [onSessionExpired, session.user.id, session.user.tenantId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(undefined);
      setDetailState("ready");
      return;
    }
    let current = true;
    setSelected(undefined);
    setDetailState("loading");
    setDetailError("");
    void api
      .task(selectedId)
      .then((result) => {
        if (!current) return;
        setSelected(result.task);
        setDetailState("ready");
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (error instanceof ApiError && error.status === 401) {
          onSessionExpired();
          return;
        }
        setDetailError(friendlyError(error));
        setDetailState("error");
      });
    return () => {
      current = false;
    };
  }, [detailAttempt, onSessionExpired, selectedId]);

  useEffect(() => {
    if (selected)
      setEditForm({
        title: selected.title,
        description: selected.description,
      });
  }, [selected]);

  const recoverTask = useCallback(
    async (id: string) => {
      try {
        const result = await api.task(id);
        replaceTask(result.task);
        setDetailError("");
        setDetailState("ready");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          onSessionExpired();
          return;
        }
        setDetailError(friendlyError(error));
        setDetailState("error");
      }
    },
    [onSessionExpired, replaceTask],
  );

  async function perform(
    action: () => Promise<{ task: Task }>,
    success: string,
  ) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      replaceTask(result.task);
      setNotice({ kind: "success", text: success });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) {
          onSessionExpired();
          return;
        }
        if (error.status === 409 && selectedId) void recoverTask(selectedId);
      }
      setNotice({ kind: "error", text: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setCreateError("");
    try {
      const result = await api.create(createForm, session.csrfToken);
      replaceTask(result.task);
      setCreateForm({ title: "", description: "" });
      setOverlay(null);
      setNotice({ kind: "success", text: "Task created." });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) {
          onSessionExpired();
          return;
        }
      }
      setCreateError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!selected) return;
    setBusy(true);
    setDeleteError("");
    try {
      await api.delete(selected, session.csrfToken);
      setTasks((current) => current.filter((task) => task.id !== selected.id));
      setSelected(undefined);
      setSelectedId(undefined);
      setOverlay(null);
      setNotice({ kind: "success", text: "Task deleted." });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) {
          onSessionExpired();
          return;
        }
        if (error.status === 409) void recoverTask(selected.id);
      }
      setDeleteError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function switchAccount() {
    setBusy(true);
    try {
      await api.logout(session.csrfToken);
      location.assign("/");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setBusy(false);
      setNotice({ kind: "error", text: friendlyError(error) });
    }
  }

  const activeTrigger =
    overlay === "create" ? createTriggerRef : deleteTriggerRef;

  const closeOverlay = useCallback(() => setOverlay(null), []);

  return (
    <div className="app-shell">
      <div
        aria-hidden={overlay ? true : undefined}
        className="app-content"
        inert={overlay ? true : undefined}
      >
        <BrandRail
          session={session}
          onSwitchAccount={() => void switchAccount()}
        />
        <main
          className={`workspace ${selectedId ? "has-selection" : "no-selection"}`}
        >
          <aside className="task-ledger" aria-label="Tasks">
            <div className="task-list-heading">
              <h2>Tasks</h2>
              <button
                className="primary compact"
                onClick={() => {
                  setCreateError("");
                  setOverlay("create");
                }}
                ref={createTriggerRef}
                type="button"
              >
                <Plus aria-hidden="true" size={18} weight="bold" />
                New task
              </button>
            </div>
            <div className="task-rows">
              {listState === "loading" ? (
                <p className="state">Loading tasks…</p>
              ) : listState === "error" ? (
                <div className="state state-action" role="alert">
                  <p>{listError}</p>
                  <button
                    className="secondary"
                    onClick={() => void loadTasks()}
                  >
                    Retry
                  </button>
                </div>
              ) : tasks.length === 0 ? (
                <p className="state">No tasks yet.</p>
              ) : (
                tasks.map((task) => (
                  <button
                    key={task.id}
                    className={
                      task.id === selectedId ? "task-row active" : "task-row"
                    }
                    onClick={() => {
                      setNotice(null);
                      setSelectedId(task.id);
                      if (task.id === selectedId)
                        setDetailAttempt((current) => current + 1);
                    }}
                    type="button"
                  >
                    <span className="task-row-copy">
                      <strong>{task.title}</strong>
                      <small>
                        Owner: {userNames[task.ownerId] ?? task.ownerId}
                        <i aria-hidden="true">·</i>
                        Assignee:{" "}
                        {task.assigneeId
                          ? (userNames[task.assigneeId] ?? task.assigneeId)
                          : "Unassigned"}
                      </small>
                    </span>
                    <span className={`task-status task-status--${task.status}`}>
                      {task.status.replace("-", " ")}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="task-workspace">
            {detailState === "loading" && selectedId ? (
              <p className="state large">Loading task…</p>
            ) : detailState === "error" && selectedId ? (
              <div className="state large state-action" role="alert">
                <p>{detailError}</p>
                <button
                  className="secondary"
                  onClick={() => setDetailAttempt((current) => current + 1)}
                  type="button"
                >
                  Retry
                </button>
              </div>
            ) : selected ? (
              <>
                <div className="task-titlebar">
                  <button
                    className="back-button"
                    onClick={() => setSelectedId(undefined)}
                    type="button"
                  >
                    <ArrowLeft aria-hidden="true" size={18} />
                    Back to tasks
                  </button>
                  <div className="task-title-copy">
                    <h2>{selected.title}</h2>
                    <span className={`status status--${selected.status}`}>
                      {selected.status.replace("-", " ")}
                    </span>
                  </div>
                </div>

                <dl className="facts">
                  <div>
                    <dt>Owner</dt>
                    <dd>{userNames[selected.ownerId] ?? selected.ownerId}</dd>
                  </div>
                  <div>
                    <dt>Assignee</dt>
                    <dd>
                      {selected.assigneeId
                        ? (userNames[selected.assigneeId] ??
                          selected.assigneeId)
                        : "Unassigned"}
                    </dd>
                  </div>
                  <div>
                    <dt>Tenant</dt>
                    <dd>{selected.tenantId.replace("-", " ")}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>{selected.version}</dd>
                  </div>
                </dl>

                <form
                  className="task-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(
                      () => api.edit(selected, editForm, session.csrfToken),
                      "Task updated.",
                    );
                  }}
                >
                  <div className="field-grid">
                    <label>
                      Title
                      <input
                        value={editForm.title}
                        maxLength={120}
                        required
                        onChange={(event) =>
                          setEditForm({
                            ...editForm,
                            title: event.target.value,
                          })
                        }
                        disabled={busy}
                      />
                    </label>
                    <label className="description-field">
                      Description
                      <textarea
                        value={editForm.description}
                        maxLength={2000}
                        rows={4}
                        onChange={(event) =>
                          setEditForm({
                            ...editForm,
                            description: event.target.value,
                          })
                        }
                        disabled={busy}
                      />
                    </label>
                  </div>
                  <div className="actions">
                    <button className="secondary" disabled={busy}>
                      Save changes
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          () =>
                            api.assign(
                              selected,
                              nextAssignee.id,
                              session.csrfToken,
                            ),
                          `Task assigned to ${nextAssignee.name}.`,
                        )
                      }
                      type="button"
                    >
                      Assign to {nextAssignee.name}
                    </button>
                    <button
                      className="primary compact"
                      disabled={busy || selected.status === "completed"}
                      onClick={() =>
                        void perform(
                          () => api.complete(selected, session.csrfToken),
                          "Task completed.",
                        )
                      }
                      type="button"
                    >
                      <CheckCircle aria-hidden="true" size={18} />
                      Complete task
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => {
                        setDeleteError("");
                        setOverlay("delete");
                      }}
                      ref={deleteTriggerRef}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="state large">Select a task.</div>
            )}
            {notice && (
              <p
                className={`toast toast--${notice.kind}`}
                role={notice.kind === "error" ? "alert" : "status"}
              >
                {notice.kind === "success" ? (
                  <CheckCircle aria-hidden="true" size={20} weight="fill" />
                ) : (
                  <WarningCircle aria-hidden="true" size={20} weight="fill" />
                )}
                {notice.text}
              </p>
            )}
          </section>
        </main>

        <ProgramFooter />
      </div>

      {overlay && (
        <Modal
          describedBy={
            overlay === "delete" ? "delete-task-description" : undefined
          }
          labelledBy={`${overlay}-modal-title`}
          onClose={closeOverlay}
          triggerRef={activeTrigger}
        >
          {overlay === "create" ? (
            <section className="task-dialog">
              <ModalHeading
                id="create-modal-title"
                title="Create task"
                onClose={closeOverlay}
              />
              <form onSubmit={(event) => void createTask(event)}>
                <label>
                  Title
                  <input
                    data-autofocus
                    value={createForm.title}
                    maxLength={120}
                    required
                    onChange={(event) =>
                      setCreateForm({
                        ...createForm,
                        title: event.target.value,
                      })
                    }
                    disabled={busy}
                  />
                </label>
                <label>
                  Description
                  <textarea
                    value={createForm.description}
                    maxLength={2000}
                    rows={5}
                    onChange={(event) =>
                      setCreateForm({
                        ...createForm,
                        description: event.target.value,
                      })
                    }
                    disabled={busy}
                  />
                </label>
                {createError && (
                  <p className="inline-feedback" role="alert">
                    {createError}
                  </p>
                )}
                <div className="dialog-actions">
                  <button
                    className="secondary"
                    onClick={closeOverlay}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button className="primary" disabled={busy}>
                    Create task
                  </button>
                </div>
              </form>
            </section>
          ) : (
            <section className="task-dialog task-dialog--delete">
              <ModalHeading
                id="delete-modal-title"
                title="Delete task?"
                onClose={closeOverlay}
              />
              <p id="delete-task-description">
                <strong>{selected?.title}</strong> will be permanently deleted.
              </p>
              {deleteError && (
                <p className="inline-feedback" role="alert">
                  {deleteError}
                </p>
              )}
              <div className="dialog-actions">
                <button
                  className="secondary"
                  data-autofocus
                  onClick={closeOverlay}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="danger danger-solid"
                  disabled={busy}
                  onClick={() => void confirmDelete()}
                  type="button"
                >
                  Delete task
                </button>
              </div>
            </section>
          )}
        </Modal>
      )}
    </div>
  );
}

function ModalHeading({
  id,
  title,
  onClose,
}: Readonly<{ id: string; title: string; onClose: () => void }>) {
  return (
    <div className="dialog-heading">
      <h2 id={id}>{title}</h2>
      <button
        aria-label={`Close ${title.toLowerCase()}`}
        className="icon-button"
        onClick={onClose}
        type="button"
      >
        <X aria-hidden="true" size={22} />
      </button>
    </div>
  );
}

type SessionState =
  | { kind: "loading" }
  | { kind: "authenticated"; session: Session }
  | { kind: "unauthenticated"; expired: boolean }
  | { kind: "error" };

export default function App() {
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

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  if (sessionState.kind === "loading")
    return (
      <main className="landing loading-screen">
        <p className="state">Loading session…</p>
      </main>
    );
  if (sessionState.kind === "error")
    return <ServiceFailure retry={() => void loadSession()} />;

  return sessionState.kind === "authenticated" ? (
    <Workspace
      session={sessionState.session}
      onSessionExpired={() =>
        setSessionState({ kind: "unauthenticated", expired: true })
      }
    />
  ) : (
    <Login expired={sessionState.expired} />
  );
}
