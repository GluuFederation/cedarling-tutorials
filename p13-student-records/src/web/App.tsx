import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  accounts,
  type DraftInput,
  type GradeView,
  type Publication,
  type SessionView,
} from "../shared/contracts.ts";
import { ApiError, api } from "./api.ts";
import mark from "./assets/cedarling-mark.png";
import wordmark from "./assets/cedarling-wordmark-dark.webp";
import { GradeDetail } from "./GradeDetail.tsx";
import { Icon } from "./Icon.tsx";

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("");
}

function Shell({
  session,
  onSwitch,
  children,
}: {
  session?: SessionView;
  onSwitch?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <header className="brand-rail">
        <picture className="brand-lockup">
          <source media="(max-width: 760px)" srcSet={mark} />
          <img src={wordmark} alt="Cedarling" />
        </picture>
        <div className="topbar-copy">
          <h1>
            P13 - Protecting Grade Publication and Guardian Access with
            Cedarling
          </h1>
          <p>Publish grades and control student and guardian access.</p>
        </div>
        {session ? (
          <details className="account-menu">
            <summary className="rail-identity" aria-label="Open account menu">
              <span className="identity-avatar" aria-hidden="true">
                {initials(session.user.name)}
              </span>
              <span className="identity-copy">
                <strong>{session.user.name}</strong>
                <small>{session.user.role}</small>
              </span>
            </summary>
            <div className="account-menu-items">
              <button type="button" onClick={onSwitch}>
                Change account
              </button>
              <button type="button" onClick={onSwitch}>
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
function errorText(error: unknown): string {
  return error instanceof ApiError
    ? `${error.message}${error.requestId ? ` Request: ${error.requestId}` : ""}`
    : "Service could not be reached. Try again.";
}

function Workspace({
  session,
  expire,
  switchIdentity,
}: {
  session: SessionView;
  expire: () => void;
  switchIdentity: () => void;
}) {
  const [grades, setGrades] = useState<GradeView[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [selected, setSelected] = useState<GradeView>();
  const [listState, setListState] = useState("loading");
  const [detailState, setDetailState] = useState("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const currentAttempt = useRef(attempt);
  currentAttempt.current = attempt;
  const live = useRef(true);
  const detailHeading = useRef<HTMLElement>(null);
  const selectionButton = useRef<HTMLButtonElement>(null);
  const mutationId = useRef(0);
  const failedLoad = useRef<number | undefined>(undefined);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      mutationId.current += 1;
    };
  }, []);
  const fail = useCallback(
    (failure: unknown) => {
      if (failure instanceof ApiError && failure.status === 401) {
        expire();
        return;
      }
      setError(errorText(failure));
    },
    [expire],
  );
  useEffect(() => {
    const controller = new AbortController();
    const epoch = attempt;
    failedLoad.current = undefined;
    setGrades([]);
    setSelected(undefined);
    setListState("loading");
    setError("");
    api
      .list(session.user.role, controller.signal)
      .then((result) => {
        if (
          controller.signal.aborted ||
          epoch !== currentAttempt.current ||
          failedLoad.current === epoch
        )
          return;
        setGrades(result.grades);
        setListState("ready");
        setSelectedId((current) =>
          result.grades.some((item) => item.id === current)
            ? current
            : undefined,
        );
      })
      .catch((failure) => {
        if (!controller.signal.aborted && epoch === currentAttempt.current) {
          failedLoad.current = epoch;
          setSelected(undefined);
          setListState("error");
          fail(failure);
        }
      });
    return () => controller.abort();
  }, [session.user.role, attempt, fail]);
  useEffect(() => {
    const controller = new AbortController();
    const epoch = attempt;
    setSelected(undefined);
    setDetailState("loading");
    setError("");
    if (selectedId)
      api
        .read(session.user.role, selectedId, controller.signal)
        .then((view) => {
          if (
            !controller.signal.aborted &&
            epoch === currentAttempt.current &&
            failedLoad.current !== epoch
          ) {
            setSelected(view);
            setDetailState("ready");
          }
        })
        .catch((failure) => {
          if (!controller.signal.aborted && epoch === currentAttempt.current) {
            failedLoad.current = epoch;
            setGrades([]);
            setDetailState("error");
            fail(failure);
          }
        });
    return () => controller.abort();
  }, [selectedId, session.user.role, attempt, fail]);
  const perform = async (
    action: () => Promise<GradeView | Publication>,
    message: string,
  ) => {
    const operation = ++mutationId.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (!live.current || operation !== mutationId.current) return;
      setSelected(undefined);
      setGrades([]);
      setAttempt((value) => value + 1);
      const correlation =
        "requestId" in result ? ` Request: ${result.requestId}` : "";
      setNotice(`${message}${correlation}`);
    } catch (failure) {
      if (live.current && operation === mutationId.current) {
        setSelected(undefined);
        setGrades([]);
        setDetailState("error");
        fail(failure);
      }
    } finally {
      if (live.current && operation === mutationId.current) setBusy(false);
    }
  };
  const select = (id: string) => {
    if (busy) return;
    setNotice("");
    setSelected(undefined);
    setSelectedId(id);
    if (id === selectedId) setAttempt((value) => value + 1);
    requestAnimationFrame(() => detailHeading.current?.focus());
  };
  const save = async (input: DraftInput) => {
    if (selected)
      await perform(
        () => api.save(selected.id, input, session.csrfToken),
        "Draft saved.",
      );
  };
  const publish = async () => {
    if (selected)
      await perform(
        () =>
          api.publish(selected.id, selected.grade.version, session.csrfToken),
        "Grade published.",
      );
  };
  const back = selectedId && (
    <button
      type="button"
      className="back-button"
      onClick={() => {
        const previous = selectionButton.current;
        setSelectedId(undefined);
        setSelected(undefined);
        requestAnimationFrame(() => previous?.focus());
      }}
    >
      <Icon name="left" />
      Back to grades
    </button>
  );
  return (
    <Shell session={session} onSwitch={switchIdentity}>
      <main
        className={`workspace ${selectedId ? "has-selection" : "no-selection"}`}
      >
        <aside className="grade-ledger" aria-label="Grades">
          <div className="list-heading">
            <h2>Grades</h2>
            <button
              type="button"
              className="secondary compact"
              disabled={busy || listState === "loading"}
              onClick={() => setAttempt((value) => value + 1)}
              aria-label="Reload grades"
            >
              <Icon name="refresh" />
            </button>
          </div>
          <div className="grade-rows">
            {listState === "loading" ? (
              <p className="state" role="status">
                Loading grades…
              </p>
            ) : listState === "error" ? (
              <p className="state" role="alert">
                {error || "Could not load grades."}
              </p>
            ) : grades.length === 0 ? (
              <p className="state">No grades available.</p>
            ) : (
              grades.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  className={`grade-row ${view.id === selectedId ? "active" : ""}`}
                  aria-current={view.id === selectedId ? "true" : undefined}
                  disabled={busy}
                  ref={view.id === selectedId ? selectionButton : undefined}
                  onClick={() => select(view.id)}
                >
                  <span className="grade-row-copy">
                    <strong>
                      {view.grade.course} · {view.grade.assessment}
                    </strong>
                    {"studentName" in view.grade && (
                      <small>{view.grade.studentName}</small>
                    )}
                  </span>
                  <span
                    className={`row-state ${view.grade.publishedAt ? "published" : "draft"}`}
                  >
                    {view.grade.publishedAt ? "Published" : "Draft"}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>
        <section
          className="grade-detail"
          ref={detailHeading}
          tabIndex={-1}
          aria-label="Grade detail"
        >
          {!selected && back && <div className="grade-titlebar">{back}</div>}
          {error ? (
            <div className="state error" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="secondary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Reload
              </button>
            </div>
          ) : selectedId && detailState === "loading" ? (
            <p className="state" role="status">
              Loading grade…
            </p>
          ) : selected ? (
            <GradeDetail
              key={`${selected.id}:${selected.grade.version}`}
              view={selected}
              busy={busy}
              onSave={save}
              onPublish={publish}
              back={back}
            />
          ) : (
            <p className="state">Select a grade.</p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
        </section>
      </main>
    </Shell>
  );
}

export function App() {
  const [session, setSession] = useState<SessionView>();
  const [state, setState] = useState<"loading" | "login" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const currentAttempt = useRef(attempt);
  currentAttempt.current = attempt;
  const generation = useRef(0);
  const expire = useCallback(() => {
    generation.current += 1;
    setSession(undefined);
    setState("login");
    setMessage("Session expired. Choose an identity again.");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const epoch = attempt;
    const current = ++generation.current;
    setSession(undefined);
    setState("loading");
    api
      .session(controller.signal)
      .then((result) => {
        if (
          !controller.signal.aborted &&
          current === generation.current &&
          epoch === currentAttempt.current
        ) {
          setSession(result);
          setState("ready");
          setMessage("");
        }
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          current !== generation.current ||
          epoch !== currentAttempt.current
        )
          return;
        setState(
          error instanceof ApiError && error.status === 401 ? "login" : "error",
        );
        setMessage(
          error instanceof ApiError && error.status === 401
            ? ""
            : errorText(error),
        );
      });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      expire,
      Math.max(0, session.expiresAt - Date.now()),
    );
    const refresh = () => {
      generation.current += 1;
      setSession(undefined);
      setState("loading");
      setAttempt((value) => value + 1);
    };
    window.addEventListener("focus", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [session, expire]);
  const switchIdentity = async () => {
    if (!session) return;
    const csrf = session.csrfToken;
    generation.current += 1;
    setSession(undefined);
    setState("loading");
    setMessage("");
    try {
      await api.logout(csrf);
      setState("login");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setState("login");
      else {
        setState("error");
        setMessage(
          "Could not end the session. Retry to reconnect, then switch identity again.",
        );
      }
    }
  };
  if (state === "ready" && session)
    return (
      <Workspace
        key={session.user.id}
        session={session}
        expire={expire}
        switchIdentity={() => void switchIdentity()}
      />
    );
  return (
    <Shell>
      <main className="landing">
        <section className="login-panel" aria-labelledby="login-title">
          {state === "loading" ? (
            <p role="status">Loading session…</p>
          ) : state === "error" ? (
            <>
              <div className="login-heading">
                <h2 id="login-title">Application unavailable</h2>
              </div>
              <p className="inline-feedback" role="alert">
                {message}
              </p>
              <button
                className="primary"
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <div className="login-heading">
                <h2 id="login-title">Choose an identity</h2>
              </div>
              {message && (
                <p className="inline-feedback" role="alert">
                  {message}
                </p>
              )}
              <nav className="account-choices" aria-label="Tutorial identities">
                {accounts.map((account) => (
                  <a
                    key={account.id}
                    className="account-choice"
                    href={`/auth/login?login_hint=${account.id}`}
                  >
                    <span className="account-avatar" aria-hidden="true">
                      {initials(account.name)}
                    </span>
                    <span className="account-copy">
                      <strong>{account.name}</strong>
                      <small>{account.role}</small>
                    </span>
                    <Icon name="right" size={20} />
                  </a>
                ))}
              </nav>
            </>
          )}
        </section>
      </main>
    </Shell>
  );
}
