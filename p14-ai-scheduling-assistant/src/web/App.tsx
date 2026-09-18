import { useCallback, useEffect, useState } from "react";
import { tutorialUsers } from "../shared/catalog.ts";
import type {
  AssistantRequest,
  ExecutionResult,
  Meeting,
  Proposal,
  SessionView,
  Workspace,
} from "../shared/types.ts";
import { ApiError, api } from "./api.ts";
import mark from "./assets/cedarling-mark.png";
import wordmark from "./assets/cedarling-wordmark-dark.webp";
import { ArrowLeft, ArrowRight } from "./Icons.tsx";

export function App() {
  const [session, setSession] = useState<SessionView>();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [selectedId, setSelectedId] = useState(
    () => new URLSearchParams(location.search).get("meeting") ?? "",
  );
  const [requestId, setRequestId] = useState("");
  const [proposal, setProposal] = useState<Proposal>();
  const [result, setResult] = useState<ExecutionResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .session()
      .then(setSession)
      .catch(() => setSession({ authenticated: false }));
  }, []);

  const handleError = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) {
      setSession({ authenticated: false });
      setWorkspace(undefined);
      setSelectedId("");
      setError("Session expired. Choose an identity again.");
      return;
    }
    setError(cause instanceof Error ? cause.message : "Request failed.");
  }, []);

  const loadWorkspace = useCallback(
    async (preferredMeetingId?: string) => {
      try {
        const next = await api.workspace();
        setWorkspace(next);
        setRequestId((current) =>
          next.requests.some((request) => request.id === current)
            ? current
            : (next.requests[0]?.id ?? ""),
        );
        setSelectedId((current) => {
          const requested = preferredMeetingId ?? current;
          return next.meetings.some((meeting) => meeting.id === requested)
            ? requested
            : (next.meetings[0]?.id ?? "");
        });
      } catch (cause) {
        handleError(cause);
      }
    },
    [handleError],
  );

  useEffect(() => {
    if (session?.authenticated) void loadWorkspace();
  }, [session?.authenticated, loadWorkspace]);

  useEffect(() => {
    const url = new URL(location.href);
    if (selectedId) url.searchParams.set("meeting", selectedId);
    else url.searchParams.delete("meeting");
    history.replaceState(null, "", url);
  }, [selectedId]);

  const selected = workspace?.meetings.find(
    (meeting) => meeting.id === selectedId,
  );
  const selectedRequest = workspace?.requests.find(
    (request) => request.id === requestId,
  );

  function resetOutcome() {
    setProposal(undefined);
    setResult(undefined);
    setError("");
  }

  function selectMeeting(id: string) {
    setSelectedId(id);
    resetOutcome();
  }

  function selectRequest(id: string) {
    setRequestId(id);
    resetOutcome();
  }

  async function propose() {
    if (!session?.authenticated || !session.csrfToken || !requestId) return;
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const response = await api.propose(
        {
          requestId,
          ...(selectedRequest?.requiresMeeting && selected
            ? { meetingId: selected.id }
            : {}),
        },
        session.csrfToken,
      );
      setProposal(response.proposal);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!session?.authenticated || !session.csrfToken || !proposal) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.execute(proposal, session.csrfToken);
      setProposal(undefined);
      setResult(response.result);
      if (response.result.meetings)
        setWorkspace((current) =>
          current
            ? { ...current, meetings: response.result.meetings ?? [] }
            : current,
        );
      else await loadWorkspace(response.result.meeting?.id ?? selectedId);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!session?.csrfToken) return;
    await api.logout(session.csrfToken);
    location.assign("/");
  }

  if (!session) return <main className="loading-screen">Loading session…</main>;
  if (!session.authenticated || !session.user || !session.csrfToken)
    return <Login notice={error} />;

  return (
    <div className="app-shell">
      <BrandRail user={session.user} onSwitchAccount={() => void signOut()} />
      <main
        className={`workspace ${selectedId ? "has-selection" : "no-selection"}`}
      >
        <aside className="meeting-rail" aria-label="Meetings">
          <div className="list-heading">
            <h2>Meetings</h2>
            <span>{workspace?.meetings.length ?? 0}</span>
          </div>
          <div className="meeting-list">
            {workspace?.meetings.map((meeting) => (
              <button
                className={
                  meeting.id === selectedId
                    ? "meeting-row active"
                    : "meeting-row"
                }
                key={meeting.id}
                onClick={() => selectMeeting(meeting.id)}
                type="button"
              >
                <strong>{meeting.title}</strong>
                <small>{dateTime(meeting.startAt)}</small>
                <span>
                  {meeting.room.name} · v{meeting.version}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="assistant-panel" aria-labelledby="assistant-title">
          <div className="panel-heading">
            <div>
              <button
                className="back-button"
                onClick={() => selectMeeting("")}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={18} />
                Back to meetings
              </button>
              <p className="panel-kicker">Deterministic assistant simulator</p>
              <h2 id="assistant-title">Scheduling assistant</h2>
            </div>
            {selected && (
              <span className={`status status--${selected.status}`}>
                {selected.status}
              </span>
            )}
          </div>

          {selected ? (
            <MeetingDetail meeting={selected} />
          ) : (
            <p className="empty-state">No meeting is available to select.</p>
          )}

          <section className="request-section" aria-labelledby="request-title">
            <div className="section-copy">
              <h3 id="request-title">Choose an assistant request</h3>
              <p className="section-description">
                The simulator proposes intent only. The server supplies current
                resource facts before authorization.
              </p>
            </div>
            <div className="request-list">
              {workspace?.requests.map((request) => (
                <RequestButton
                  key={request.id}
                  request={request}
                  selected={request.id === requestId}
                  onSelect={selectRequest}
                />
              ))}
            </div>
            <button
              className="primary"
              type="button"
              disabled={
                busy ||
                !selectedRequest ||
                (selectedRequest.requiresMeeting && !selected)
              }
              onClick={() => void propose()}
            >
              {busy ? "Working…" : "Create proposal"}
            </button>
          </section>

          {proposal && (
            <section className="proposal" aria-labelledby="proposal-title">
              <div>
                <p className="proposal-source">{proposal.source}</p>
                <h3 id="proposal-title">{proposal.summary}</h3>
                <dl>
                  <div>
                    <dt>Action</dt>
                    <dd>{proposal.action}</dd>
                  </div>
                  <div>
                    <dt>Target</dt>
                    <dd>{proposal.target}</dd>
                  </div>
                </dl>
              </div>
              <button
                className="primary"
                type="button"
                disabled={busy}
                onClick={() => void execute()}
              >
                Run action
              </button>
            </section>
          )}

          <ResultNotice error={error} {...(result ? { result } : {})} />
        </section>
      </main>
      <ProgramFooter />
    </div>
  );
}

function BrandRail({
  user,
  onSwitchAccount,
}: Readonly<{
  user?: NonNullable<SessionView["user"]>;
  onSwitchAccount?: () => void;
}>) {
  return (
    <header className="brand-rail">
      <picture className="brand-lockup">
        <source media="(max-width: 760px)" srcSet={mark} />
        <img src={wordmark} alt="Cedarling" />
      </picture>
      <div className="topbar-copy">
        <h1>P14 - Governing an AI Scheduling Assistant with Cedarling</h1>
        <p>Authorize each proposed scheduling effect with current facts.</p>
      </div>
      {user ? (
        <details className="account-menu">
          <summary className="rail-identity" aria-label="Open account menu">
            <span className="identity-avatar" aria-hidden="true">
              {initials(user.name)}
            </span>
            <span className="identity-copy">
              <strong>{user.name}</strong>
              <small>{user.role}</small>
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

function Login({ notice }: Readonly<{ notice?: string }>) {
  return (
    <div className="login-shell">
      <BrandRail />
      <main className="landing">
        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-heading">
            <h2 id="login-title">Choose a tutorial identity</h2>
            <p className="login-subtitle">
              Compare one scheduling workflow across workplace roles.
            </p>
          </div>
          {notice && (
            <p className="inline-feedback" role="alert">
              {notice}
            </p>
          )}
          <nav className="account-choices" aria-label="Tutorial identities">
            {tutorialUsers.map((user) => (
              <a
                className="account-choice"
                href={`/auth/login?login_hint=${user.subject}`}
                key={user.id}
              >
                <span className="account-avatar" aria-hidden="true">
                  {initials(user.name)}
                </span>
                <span className="account-copy">
                  <strong>{user.name}</strong>
                  <small>
                    {user.role} · {user.kind}
                  </small>
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

function RequestButton({
  request,
  selected,
  onSelect,
}: Readonly<{
  request: AssistantRequest;
  selected: boolean;
  onSelect: (id: string) => void;
}>) {
  return (
    <button
      aria-pressed={selected}
      className={selected ? "request-option active" : "request-option"}
      onClick={() => onSelect(request.id)}
      type="button"
    >
      {request.label}
    </button>
  );
}

function MeetingDetail({ meeting }: Readonly<{ meeting: Meeting }>) {
  return (
    <dl className="meeting-facts">
      <div>
        <dt>Organizer</dt>
        <dd>{meeting.organizerName}</dd>
      </div>
      <div>
        <dt>Room</dt>
        <dd>{meeting.room.name}</dd>
      </div>
      <div>
        <dt>Starts</dt>
        <dd>{dateTime(meeting.startAt)}</dd>
      </div>
      <div>
        <dt>Attendees</dt>
        <dd>{meeting.attendeeNames.join(", ") || "None"}</dd>
      </div>
    </dl>
  );
}

function ResultNotice({
  error,
  result,
}: Readonly<{ error: string; result?: ExecutionResult }>) {
  return (
    <div
      className={error ? "result-notice error" : "result-notice"}
      role="status"
      aria-live="polite"
    >
      <span>
        {error || result?.message || "Proposals remain inert until confirmed."}
      </span>
      {!error && result?.slots && (
        <ul>
          {result.slots.map((slot) => (
            <li key={slot}>{dateTime(slot)}</li>
          ))}
        </ul>
      )}
      {!error && result?.meetings && (
        <ul>
          {result.meetings.map((meeting) => (
            <li key={meeting.id}>{meeting.title}</li>
          ))}
        </ul>
      )}
    </div>
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

const initials = (name: string) =>
  name
    .split(/\s+/u)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const dateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
