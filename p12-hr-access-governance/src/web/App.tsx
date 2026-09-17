import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  Contact,
  Grant,
  Profile,
  SessionView,
} from "../shared/contracts.ts";
import { accounts } from "../shared/contracts.ts";
import { ApiError, api, mutate, type Remote, useRemote } from "./api.ts";
import mark from "./assets/cedarling-mark.png";
import wordmark from "./assets/cedarling-wordmark-dark.webp";
import { Icon } from "./Icons.tsx";

function Shell({
  children,
  session,
  switchAccount,
}: {
  children: ReactNode;
  session?: SessionView;
  switchAccount?: () => void;
}) {
  return (
    <div className="app-shell">
      <header className="brand-rail">
        <picture className="brand-lockup">
          <source media="(max-width:760px)" srcSet={mark} />
          <img src={wordmark} alt="Cedarling" />
        </picture>
        <div className="topbar-copy">
          <h1>P12 - Governing Employee Record Access with Cedarling</h1>
          <p>Request, review, and revoke access to employee contact fields.</p>
        </div>
        {session ? (
          <details className="account-menu">
            <summary className="rail-identity" aria-label="Open account menu">
              <span className="identity-avatar" aria-hidden="true">
                {session.user.name[0]}
              </span>
              <span className="identity-copy">
                <strong>{session.user.name}</strong>
                <small>{session.user.role}</small>
              </span>
            </summary>
            <div className="account-menu-items">
              <button type="button" onClick={switchAccount}>
                Change account
              </button>
              <button type="button" onClick={switchAccount}>
                Sign out
              </button>
            </div>
          </details>
        ) : (
          <span aria-hidden="true" />
        )}
      </header>
      {children}
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
    </div>
  );
}
function State<T>({
  remote,
  retry,
  children,
}: {
  remote: Remote<T>;
  retry: () => void;
  children: (value: T) => ReactNode;
}) {
  if (remote.state === "loading")
    return (
      <p className="state" role="status">
        Loading…
      </p>
    );
  if (remote.state === "error")
    return (
      <div className="state state-action">
        <p role="alert">{remote.message}</p>
        <button className="secondary" type="button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  return children(remote.data);
}
function useDetailFocus(selected: string | null) {
  const ledger = useRef<HTMLElement>(null);
  const detail = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (window.matchMedia?.("(max-width: 760px)").matches) {
      if (selected) detail.current?.focus();
      else if (previous.current) {
        const row = [
          ...(ledger.current?.querySelectorAll<HTMLButtonElement>(
            "[data-resource-id]",
          ) ?? []),
        ].find((item) => item.dataset.resourceId === previous.current);
        (row ?? heading.current)?.focus();
      }
    }
    previous.current = selected;
  }, [selected]);
  return { ledger, detail, heading };
}
function RequestDialog({
  session,
  employee,
  close,
  created,
  active,
  expired,
}: {
  session: SessionView;
  employee: Profile;
  close: () => void;
  created: (grant: Grant, requestId: string) => void;
  active: () => Promise<void>;
  expired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [days, setDays] = useState(1);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const previous = document.activeElement;
    dialog.current?.showModal();
    dialog.current?.querySelector("select")?.focus();
    return () => {
      live.current = false;
      dialog.current?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await mutate<Grant>("/api/grants", session.csrfToken, {
        employeeId: employee.id,
        days,
      });
      if (live.current) created(result.data, result.requestId);
    } catch (error) {
      if (!live.current) return;
      if (error instanceof ApiError && error.status === 401) expired();
      else if (
        error instanceof ApiError &&
        error.code === "ACTIVE_GRANT_EXISTS"
      )
        await active();
      else setError(error instanceof Error ? error.message : "Request failed.");
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="request-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="dialog-heading">
          <h2 id="request-title">Request access</h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Close request access"
            disabled={busy}
            onClick={close}
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        <p>
          {employee.name} · {employee.jobTitle}
          <br />
          Basic and contact fields for the selected employee
        </p>
        <p>Current manager: {employee.managerName}</p>
        <label>
          Duration
          <select
            disabled={busy}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <option key={day} value={day}>
                {day} {day === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="inline-feedback">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Requesting…" : "Request access"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
function Access({
  session,
  expired,
  initialSelection = null,
}: {
  session: SessionView;
  expired: () => void;
  initialSelection?: string | null;
}) {
  const list = useRemote<Grant[]>("/api/grants?view=review", expired);
  const [selected, setSelected] = useState<string | null>(initialSelection);
  const focus = useDetailFocus(selected);
  const detail = useRemote<Grant>(
    selected ? `/api/grants/${selected}` : null,
    expired,
  );
  const [notice, setNotice] = useState<{
    message: string;
    failure: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    list.refresh();
    detail.refresh();
  }, [list.refresh, detail.refresh]);
  const expiresAt =
    detail.result.state === "ready" &&
    (detail.result.data.status === "pending" ||
      detail.result.data.status === "approved")
      ? detail.result.data.expiresAt
      : null;
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = setTimeout(refresh, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, refresh]);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function transition(grant: Grant) {
    setBusy(true);
    setNotice(null);
    try {
      const operation = grant.status === "pending" ? "approve" : "revoke";
      const result = await mutate<Grant>(
        `/api/grants/${grant.id}/${operation}`,
        session.csrfToken,
        { version: grant.version },
      );
      if (!live.current) return;
      setNotice({
        message: `Access ${result.data.status}. (${result.requestId})`,
        failure: false,
      });
      refresh();
    } catch (error) {
      if (!live.current) return;
      if (error instanceof ApiError && error.status === 401) expired();
      else {
        setNotice({
          message: error instanceof Error ? error.message : "Request failed.",
          failure: true,
        });
        refresh();
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <main
      className={`workspace ${selected ? "has-selection" : "no-selection"}`}
    >
      <aside className="ledger" aria-label="Access grants" ref={focus.ledger}>
        <div className="list-heading">
          <h2 ref={focus.heading} tabIndex={-1}>
            Access requests
          </h2>
        </div>
        <div className="rows">
          <State remote={list.result} retry={list.refresh}>
            {(grants) =>
              grants.length ? (
                grants.map((grant) => (
                  <button
                    className={`resource-row ${selected === grant.id ? "active" : ""}`}
                    type="button"
                    key={grant.id}
                    data-resource-id={grant.id}
                    onClick={() => {
                      setSelected(grant.id);
                      setNotice(null);
                      detail.refresh();
                    }}
                  >
                    <span className="row-copy">
                      <strong>{grant.employeeName}</strong>
                      <small>
                        {grant.managerName} · requested by {grant.requesterName}
                      </small>
                    </span>
                    <span className={`row-status ${grant.status}`}>
                      {grant.status}
                    </span>
                  </button>
                ))
              ) : (
                <p className="state">No requests yet.</p>
              )
            }
          </State>
        </div>
      </aside>
      <section
        className="detail"
        aria-label="Selected grant"
        ref={focus.detail}
        tabIndex={-1}
      >
        {selected ? (
          <>
            <div className="titlebar">
              <button
                className="back-button"
                type="button"
                onClick={() => setSelected(null)}
              >
                <Icon name="back" />
                Back to access
              </button>
              {detail.result.state === "ready" && (
                <div className="title-copy">
                  <h2>{detail.result.data.employeeName}</h2>
                  <span className={`status ${detail.result.data.status}`}>
                    {detail.result.data.status}
                  </span>
                </div>
              )}
            </div>
            <State remote={detail.result} retry={detail.refresh}>
              {(grant) => (
                <>
                  <dl className="facts">
                    <div>
                      <dt>Employee</dt>
                      <dd>{grant.employeeName}</dd>
                    </div>
                    <div>
                      <dt>Manager</dt>
                      <dd>{grant.managerName}</dd>
                    </div>
                    <div>
                      <dt>Requested by</dt>
                      <dd>{grant.requesterName}</dd>
                    </div>
                    <div>
                      <dt>Access</dt>
                      <dd>Basic and contact fields</dd>
                    </div>
                    <div>
                      <dt>Expires</dt>
                      <dd>{new Date(grant.expiresAt).toLocaleString()}</dd>
                    </div>
                  </dl>
                  <div className="detail-actions">
                    {(grant.status === "pending" ||
                      grant.status === "approved") && (
                      <button
                        className={
                          grant.status === "approved" ? "danger" : "primary"
                        }
                        type="button"
                        disabled={busy}
                        onClick={() => void transition(grant)}
                      >
                        {busy
                          ? "Updating…"
                          : grant.status === "pending"
                            ? "Approve"
                            : "Revoke"}
                      </button>
                    )}
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy}
                      onClick={refresh}
                    >
                      Refresh
                    </button>
                  </div>
                </>
              )}
            </State>
          </>
        ) : (
          <p className="state large">Select a request.</p>
        )}
        {notice && (
          <p
            className={`notice ${notice.failure ? "error" : "success"}`}
            role={notice.failure ? "alert" : "status"}
          >
            {notice.message}
          </p>
        )}
      </section>
    </main>
  );
}
function Employees({
  session,
  expired,
  canRequest,
  created,
}: {
  session: SessionView;
  expired: () => void;
  canRequest: boolean;
  created: (grant: Grant) => void;
}) {
  const list = useRemote<Profile[]>("/api/employees", expired);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [notice, setNotice] = useState("");
  const focus = useDetailFocus(selected);
  const profile = useRemote<Profile>(
    selected ? `/api/employees/${selected}/profile` : null,
    expired,
  );
  const contact = useRemote<Contact>(
    selected && !canRequest ? `/api/employees/${selected}/contact` : null,
    expired,
  );
  const currentEmployee =
    profile.result.state === "ready" ? profile.result.data : null;
  return (
    <main
      className={`workspace ${selected ? "has-selection" : "no-selection"}`}
    >
      <aside className="ledger" aria-label="Employees" ref={focus.ledger}>
        <div className="list-heading">
          <h2 ref={focus.heading} tabIndex={-1}>
            Employees
          </h2>
        </div>
        <div className="rows">
          <State remote={list.result} retry={list.refresh}>
            {(employees) =>
              employees.length ? (
                employees.map((person) => (
                  <button
                    className={`resource-row ${selected === person.id ? "active" : ""}`}
                    key={person.id}
                    data-resource-id={person.id}
                    type="button"
                    onClick={() => {
                      setSelected(person.id);
                      profile.refresh();
                      contact.refresh();
                    }}
                  >
                    <span className="row-copy">
                      <strong>{person.name}</strong>
                      <small>{person.team}</small>
                    </span>
                  </button>
                ))
              ) : (
                <p className="state">No employees available.</p>
              )
            }
          </State>
        </div>
      </aside>
      <section
        className="detail"
        aria-label="Employee details"
        ref={focus.detail}
        tabIndex={-1}
      >
        {selected ? (
          <>
            <div className="titlebar">
              <button
                className="back-button"
                type="button"
                onClick={() => setSelected(null)}
              >
                <Icon name="back" />
                Back to employees
              </button>
              {profile.result.state === "ready" && (
                <div className="title-copy">
                  <h2>{profile.result.data.name}</h2>
                </div>
              )}
            </div>
            <h3 className="group-heading">Basic</h3>
            <State remote={profile.result} retry={profile.refresh}>
              {(person) => (
                <dl className="facts fields">
                  <div>
                    <dt>Team</dt>
                    <dd>{person.team}</dd>
                  </div>
                  <div>
                    <dt>Job title</dt>
                    <dd>{person.jobTitle}</dd>
                  </div>
                </dl>
              )}
            </State>
            {!canRequest && (
              <>
                <h3 className="group-heading">Contact</h3>
                <State remote={contact.result} retry={contact.refresh}>
                  {(person) => (
                    <dl className="facts fields">
                      <div>
                        <dt>Work email</dt>
                        <dd>{person.workEmail}</dd>
                      </div>
                      <div>
                        <dt>Work phone</dt>
                        <dd>{person.workPhone}</dd>
                      </div>
                    </dl>
                  )}
                </State>
              </>
            )}
            <div className="detail-actions">
              {canRequest && profile.result.state === "ready" && (
                <button
                  className="primary"
                  type="button"
                  onClick={() => {
                    setNotice("");
                    setDialog(true);
                  }}
                >
                  Request access
                </button>
              )}
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  profile.refresh();
                  if (!canRequest) contact.refresh();
                  list.refresh();
                }}
              >
                Refresh
              </button>
            </div>
          </>
        ) : (
          <p className="state large">Select an employee.</p>
        )}
        {notice && (
          <p className="notice success" role="status">
            {notice}
          </p>
        )}
      </section>
      {dialog && currentEmployee && (
        <RequestDialog
          session={session}
          employee={currentEmployee}
          expired={expired}
          close={() => setDialog(false)}
          active={async () => {
            setDialog(false);
            try {
              const result = await api<Grant[]>("/api/grants?view=review");
              const active = result.data.find(
                (grant) =>
                  grant.employeeId === currentEmployee.id &&
                  (grant.status === "pending" || grant.status === "approved"),
              );
              if (active) created(active);
              else setNotice("Refresh and try again.");
            } catch (error) {
              if (error instanceof ApiError && error.status === 401) expired();
              else
                setNotice(
                  error instanceof Error ? error.message : "Refresh failed.",
                );
            }
          }}
          created={(grant) => {
            setDialog(false);
            created(grant);
          }}
        />
      )}
    </main>
  );
}
export function App() {
  const [session, setSession] = useState<SessionView | null | undefined>();
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"employees" | "requests">("employees");
  const [selectedGrant, setSelectedGrant] = useState<string | null>(null);
  const pendingSession = useRef<AbortController | null>(null);
  const expired = useCallback(() => {
    setSession(null);
    setNotice("Session expired. Choose an identity again.");
  }, []);
  const loadSession = useCallback(() => {
    pendingSession.current?.abort();
    const controller = new AbortController();
    pendingSession.current = controller;
    setNotice("");
    void api<SessionView | null>("/api/session", { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) setSession(data);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setNotice("Application unavailable. Try again.");
      });
  }, []);
  useEffect(() => {
    loadSession();
    return () => pendingSession.current?.abort();
  }, [loadSession]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      expired,
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session, expired]);
  function switchAccount() {
    pendingSession.current?.abort();
    const current = session;
    setSession(null);
    setNotice("");
    setView("employees");
    setSelectedGrant(null);
    if (current)
      void fetch("/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": current.csrfToken },
        credentials: "same-origin",
      })
        .then((response) => {
          if (!response.ok && response.status !== 401)
            setNotice(
              "Sign-out could not be confirmed. Sign in again to rotate your session.",
            );
        })
        .catch(() =>
          setNotice(
            "Sign-out could not be confirmed. Sign in again to rotate your session.",
          ),
        );
  }
  if (!session)
    return (
      <Shell>
        <main className="landing">
          <section
            className={session === undefined ? "service-state" : "login-panel"}
            aria-labelledby="login-title"
          >
            <div
              className={session === undefined ? undefined : "login-heading"}
            >
              <h2 id="login-title">
                {session === undefined
                  ? "CedarHR"
                  : "Choose a tutorial identity"}
              </h2>
              {session === null && (
                <p>Request, review, or use employee contact access.</p>
              )}
            </div>
            {notice && (
              <p role="alert" className="inline-feedback">
                {notice}
              </p>
            )}
            {session === undefined ? (
              notice ? (
                <button className="primary" type="button" onClick={loadSession}>
                  Retry
                </button>
              ) : (
                <p role="status">Loading…</p>
              )
            ) : (
              <nav className="account-choices" aria-label="Tutorial identities">
                {accounts.map((account) => (
                  <a
                    className="account-choice"
                    key={account.id}
                    href={`/auth/login?login_hint=${account.id}`}
                  >
                    <span className="account-avatar" aria-hidden="true">
                      {account.name[0]}
                    </span>
                    <span className="account-copy">
                      <strong>{account.name}</strong>
                      <small>{account.role}</small>
                    </span>
                    <Icon name="forward" size={20} />
                  </a>
                ))}
              </nav>
            )}
          </section>
        </main>
      </Shell>
    );
  return (
    <Shell session={session} switchAccount={switchAccount}>
      <div className="authenticated-workspace">
        {session.user.id === "lin" && (
          <nav className="view-tabs" aria-label="HR views">
            <button
              type="button"
              className={view === "employees" ? "active" : ""}
              onClick={() => setView("employees")}
            >
              Employees
            </button>
            <button
              type="button"
              className={view === "requests" ? "active" : ""}
              onClick={() => setView("requests")}
            >
              Access requests
            </button>
          </nav>
        )}
        {session.user.id === "nia" || view === "requests" ? (
          <Access
            key={`${session.user.id}:${selectedGrant ?? ""}`}
            session={session}
            expired={expired}
            initialSelection={selectedGrant}
          />
        ) : (
          <Employees
            key={session.user.id}
            session={session}
            expired={expired}
            canRequest={session.user.id === "lin"}
            created={(grant) => {
              setSelectedGrant(grant.id);
              setView("requests");
            }}
          />
        )}
      </div>
    </Shell>
  );
}
