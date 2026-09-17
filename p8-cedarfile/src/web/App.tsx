import { ArrowRight, WarningCircle } from "./icons.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "./api";
import cedarlingMark from "./assets/cedarling-mark.png";
import cedarlingWordmark from "./assets/cedarling-wordmark-dark.webp";
import { ResourceDialogs, type Overlay } from "./ResourceDialogs";
import { ExplorerPane, ResourceDetailsPane } from "./resource-ui";
import type { Resource, ResourceDetails, Session } from "./types";

type Notice = { kind: "success" | "error"; text: string } | null;

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
    invalid_name: "Use a clear file name without path or invisible characters.",
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
        <source media="(max-width: 760px)" srcSet={cedarlingMark} />
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
  const [notice, setNotice] = useState<Notice>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [text, setText] = useState("");
  const overlayInvokerRef = useRef<HTMLButtonElement>(null);

  const selected = details?.resource;
  const folders = useMemo(
    () =>
      resources.filter(
        (resource) => resource.kind === "folder" && resource.id !== selectedId,
      ),
    [resources, selectedId],
  );
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
      .catch(handleError)
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [handleError, selectedId]);
  useEffect(() => {
    if (selected?.kind !== "file") {
      setPreviewUrl(undefined);
      setText("");
      return;
    }
    let active = true;
    let objectUrl: string | undefined;
    void api
      .content(selected.id)
      .then(async (blob) => {
        if (!active) return;
        if (selected.mediaType?.startsWith("text/")) setText(await blob.text());
        else {
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
        }
      })
      .catch(handleError);
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
    if (resource.id === selectedId) return;
    setDetails(undefined);
    setSelectedId(resource.id);
  }

  function openOverlay(
    value: Exclude<Overlay, null>,
    invoker: HTMLButtonElement,
  ) {
    overlayInvokerRef.current = invoker;
    setOverlay(value);
  }
  async function saveText() {
    if (!selected) return;
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

  return (
    <div className="workspace">
      {notice && (
        <p
          className={`notice ${notice.kind} workspace-notice`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      <ExplorerPane
        folder={folder}
        loading={loading}
        onOpenOverlay={openOverlay}
        onParent={(id) => void loadFolder(id)}
        onSelect={selectResource}
        resources={resources}
        selectedId={selectedId}
      />
      <ResourceDetailsPane
        busy={busy}
        detailLoading={detailLoading}
        details={details}
        folders={folders}
        onBack={() => {
          setSelectedId(undefined);
          setDetails(undefined);
        }}
        onOpenFolder={(id) => void loadFolder(id)}
        onOpenOverlay={openOverlay}
        onSaveText={() => void saveText()}
        onTextChange={setText}
        previewUrl={previewUrl}
        selectedId={selectedId}
        text={text}
      />
      <ResourceDialogs
        busy={busy}
        csrfToken={session.csrfToken}
        details={details}
        folders={folders}
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
