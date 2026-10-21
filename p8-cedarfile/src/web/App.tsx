import { ArrowRight, WarningCircle } from "./icons.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api";
import cedarlingMark from "./assets/cedarling-mark.png";
import cedarlingWordmark from "./assets/cedarling-wordmark-dark.webp";
import { ResourceDialogs, type Overlay } from "./ResourceDialogs";
import { ExplorerPane, ResourceDetailsPane } from "./resource-ui";
import type { Resource, ResourceDetails, Session } from "./types";
import { TransientNotice, type Notice } from "./TransientNotice";

const accounts = [
  {
    id: "jordan",
    initials: "JO",
    name: "Jordan",
    context: "Workspace A owner",
  },
  {
    id: "priya",
    initials: "PR",
    name: "Priya",
    context: "Shared-folder editor",
  },
  { id: "lee", initials: "LE", name: "Lee", context: "Single-file viewer" },
] as const;

function friendlyError(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "request_failed";
  const messages: Record<string, string> = {
    invalid_name:
      "Use a visible file name without path separators or control characters.",
    unsupported_file_type:
      "Choose a supported text, document, image, audio, or video file.",
    signature_mismatch: "The file content does not match its extension.",
    invalid_utf8: "Text and Markdown files must contain valid UTF-8 text.",
    file_too_large: "A file can be at most 16 MiB.",
    workspace_quota_exceeded: "This workspace has reached its storage limit.",
    workspace_resource_limit: "This workspace has reached its resource limit.",
    name_collision: "A sibling already uses that name.",
    stale_resource_version: "This resource changed. Reload and try again.",
    resource_not_found: "This resource is missing or unavailable.",
    request_verification_failed: "The request could not be verified.",
  };
  return messages[code] ?? "The application could not complete the request.";
}

function BrandRail({
  session,
  onSwitch,
}: Readonly<{ session?: Session; onSwitch?: () => void }>) {
  return (
    <header className="brand-rail">
      <picture className="brand-lockup">
        <source media="(max-width: 960px)" srcSet={cedarlingMark} />
        <img alt="Cedarling" src={cedarlingWordmark} />
      </picture>
      <div className="topbar-copy">
        <h1>
          P8 - Securing File Sharing and Blocking Path Traversal with Cedarling
        </h1>
        <p>Keep authorization and filesystem safety separate.</p>
      </div>
      {session ? (
        <details className="account-menu">
          <summary className="rail-identity" aria-label="Open account menu">
            <span className="identity-avatar" aria-hidden="true">
              {session.user.name.slice(0, 2).toUpperCase()}
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
        <span />
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="program-footer">
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
      <main className="landing">
        <section className="login-panel" aria-labelledby="login-title">
          <div>
            <h2 id="login-title">Choose an identity</h2>
            <p>Explore the same workspace with different access.</p>
          </div>
          {expired && (
            <p className="notice error" role="alert">
              Session expired. Choose an identity again.
            </p>
          )}
          <nav className="account-list" aria-label="Tutorial identities">
            {accounts.map((account) => (
              <a
                className="account"
                href={`/auth/login?login_hint=${account.id}`}
                key={account.id}
              >
                <span className="account-avatar" aria-hidden="true">
                  {account.initials}
                </span>
                <span>
                  <strong>{account.name}</strong>
                  <small>{account.context}</small>
                </span>
                <ArrowRight aria-hidden="true" size={20} />
              </a>
            ))}
          </nav>
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
  const [folderId, setFolderId] = useState<string>();
  const [folder, setFolder] = useState<Resource | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [details, setDetails] = useState<ResourceDetails>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [contentReady, setContentReady] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const overlayInvokerRef = useRef<HTMLButtonElement>(null);
  const cancelledSelection = useRef<string | undefined>(undefined);

  const selected = details?.resource;
  const dirty = text !== savedText;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        expired();
        return;
      }
      setNotice({ kind: "error", text: friendlyError(error) });
    },
    [expired],
  );
  const loadFolder = useCallback(
    async (id?: string, resetSelection = true) => {
      setLoading(true);
      try {
        const result = await api.list(id);
        setFolder(result.folder);
        setResources(result.resources);
        setFolderId(id);
        if (resetSelection) {
          setSelectedId(undefined);
          setDetails(undefined);
          setNotice(null);
        }
        return result;
      } catch (error) {
        handleError(error);
      } finally {
        setLoading(false);
      }
    },
    [handleError],
  );

  useEffect(() => {
    void loadFolder();
  }, [loadFolder]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setDetailLoading(true);
    void api
      .details(selectedId)
      .then((result) => {
        if (active) setDetails(result);
      })
      .catch((error) => {
        if (active) handleError(error);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [handleError, selectedId]);
  useEffect(() => {
    setText("");
    setSavedText("");
    setPreviewUrl(undefined);
    setContentReady(false);
    if (selected?.kind !== "file") {
      setContentLoading(false);
      return;
    }
    setContentLoading(true);
    let active = true;
    let objectUrl: string | undefined;
    void api
      .content(selected.id)
      .then(async (blob) => {
        if (!active) return;
        if (selected.mediaType?.startsWith("text/")) {
          const value = await blob.text();
          if (!active) return;
          setText(value);
          setSavedText(value);
        } else {
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
        }
        if (active) setContentReady(true);
      })
      .catch((error) => {
        if (active) handleError(error);
      })
      .finally(() => {
        if (active) setContentLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [handleError, selected]);

  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setOverlay(null);
      const refreshed = await loadFolder(folderId, false);
      if (
        selectedId &&
        refreshed?.resources.some((resource) => resource.id === selectedId)
      ) {
        setDetails(await api.details(selectedId));
      } else if (selectedId) {
        setSelectedId(undefined);
        setDetails(undefined);
      }
      setNotice({ kind: "success", text: message });
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }
  function selectResource(resource: Resource) {
    cancelledSelection.current = undefined;
    if (resource.id === selectedId) return;
    if (!canLeave()) {
      cancelledSelection.current = resource.id;
      return;
    }
    setText("");
    setSavedText("");
    setDetails(undefined);
    setSelectedId(resource.id);
  }

  function openOverlay(
    value: Exclude<Overlay, null>,
    invoker: HTMLButtonElement,
  ) {
    if (!canLeave()) return;
    overlayInvokerRef.current = invoker;
    setNotice(null);
    setOverlay(value);
  }
  async function saveText() {
    if (!selected || !contentReady || busy) return;
    await mutate(
      () =>
        api.replace(
          selected,
          new Blob([text], { type: selected.mediaType ?? "text/plain" }),
          session.csrfToken,
        ),
      "File saved.",
    );
  }

  function canLeave() {
    return (
      !busy && (!dirty || window.confirm("Discard your unsaved text changes?"))
    );
  }
  function openFolder(id?: string) {
    if (canLeave()) void loadFolder(id);
  }

  return (
    <div
      className={`workspace${selectedId ? " has-selection" : ""}`}
      ref={workspaceRef}
    >
      {notice && !overlay && (
        <div className="workspace-notice">
          <TransientNotice notice={notice} onDismiss={dismissNotice} />
        </div>
      )}
      <ExplorerPane
        folder={folder}
        loading={loading}
        onOpenOverlay={openOverlay}
        onParent={openFolder}
        onOpenFolder={(resource) => {
          if (cancelledSelection.current !== resource.id)
            openFolder(resource.id);
        }}
        onSelect={selectResource}
        resources={resources}
        selectedId={selectedId}
      />
      <ResourceDetailsPane
        busy={busy}
        detailLoading={detailLoading}
        contentLoading={contentLoading}
        contentReady={contentReady}
        details={details}
        onBack={() => {
          if (!canLeave()) return;
          const previousId = selectedId;
          setSelectedId(undefined);
          setDetails(undefined);
          requestAnimationFrame(() =>
            workspaceRef.current
              ?.querySelector<HTMLButtonElement>(
                `[data-resource-id="${previousId}"]`,
              )
              ?.focus(),
          );
        }}
        onOpenFolder={openFolder}
        onOpenOverlay={openOverlay}
        onSaveText={() => void saveText()}
        onTextChange={setText}
        previewUrl={previewUrl}
        selectedId={selectedId}
        text={text}
      />
      <ResourceDialogs
        error={notice?.kind === "error" ? notice.text : undefined}
        busy={busy}
        csrfToken={session.csrfToken}
        details={details}
        onError={handleError}
        mutate={(action, message) => void mutate(action, message)}
        onClose={() => setOverlay(null)}
        overlay={overlay}
        parentId={folder?.id ?? folderId}
        returnFocus={overlayInvokerRef}
        selected={selected}
      />
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<Session>();
  const [state, setState] = useState<
    "loading" | "ready" | "anonymous" | "expired" | "error"
  >("loading");
  const load = useCallback(() => {
    setState("loading");
    void api
      .session()
      .then((value) => {
        setSession(value);
        setState("ready");
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401)
          setState("anonymous");
        else setState("error");
      });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (state === "anonymous" || state === "expired")
    return <Login expired={state === "expired"} />;
  if (state === "error") {
    return (
      <div className="app-shell">
        <BrandRail />
        <main className="landing">
          <section className="service-state">
            <WarningCircle size={30} />
            <h2>Application unavailable</h2>
            <button className="primary" onClick={load} type="button">
              Retry
            </button>
          </section>
        </main>
        <Footer />
      </div>
    );
  }
  if (!session)
    return (
      <div className="app-shell">
        <BrandRail />
        <main className="landing">
          <p>Loading session…</p>
        </main>
        <Footer />
      </div>
    );
  return (
    <div className="app-shell">
      <BrandRail
        session={session}
        onSwitch={() =>
          void api
            .logout(session.csrfToken)
            .then(() => {
              setSession(undefined);
              setState("anonymous");
            })
            .catch((error) => {
              if (error instanceof ApiError && error.status === 401) {
                setSession(undefined);
                setState("expired");
              } else setState("error");
            })
        }
      />
      <Workspace
        expired={() => {
          setSession(undefined);
          setState("expired");
        }}
        session={session}
      />
      <Footer />
    </div>
  );
}
