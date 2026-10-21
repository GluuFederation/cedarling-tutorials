import { type FormEvent, type RefObject, useEffect, useState } from "react";
import { acceptedFileInput } from "../shared/file-types";
import { api } from "./api";
import { Modal } from "./Modal";
import type { Resource, ResourceDetails } from "./types";

export type Overlay =
  | "folder"
  | "upload"
  | "replace"
  | "share"
  | "move"
  | "delete"
  | null;

type Mutate = (action: () => Promise<unknown>, message: string) => void;

function MoveDestination({
  selected,
  details,
  busy,
  csrfToken,
  mutate,
  onClose,
  onError,
}: Readonly<{
  selected: Resource;
  details: ResourceDetails;
  busy: boolean;
  csrfToken: string;
  mutate: Mutate;
  onClose: () => void;
  onError: (error: unknown) => void;
}>) {
  const ancestors = details.breadcrumbs.filter(
    (item) =>
      item.kind === "folder" &&
      item.id !== selected.id &&
      item.access !== "none",
  );
  const [target, setTarget] = useState<string | undefined>(
    ancestors.at(-1)?.id,
  );
  const [folder, setFolder] = useState<Resource | null>(null);
  const [children, setChildren] = useState<Resource[]>([]);
  const [trail, setTrail] = useState(ancestors);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    void api
      .list(target)
      .then((result) => {
        if (!active) return;
        setFolder(result.folder);
        setChildren(
          result.resources.filter(
            (item) =>
              item.kind === "folder" &&
              item.id !== selected.id &&
              item.workspaceId === selected.workspaceId,
          ),
        );
      })
      .catch((error) => {
        if (!active) return;
        setFolder(null);
        setChildren([]);
        setFailed(true);
        onError(error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [target, selected.id, selected.workspaceId, onError]);
  const allowed =
    folder &&
    folder.id !== selected.parentId &&
    folder.id !== selected.id &&
    folder.workspaceId === selected.workspaceId &&
    folder.access !== "none";
  return (
    <form
      className="dialog-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (allowed && !loading && !busy)
          mutate(
            () => api.move(selected, folder.id, csrfToken),
            "Resource moved.",
          );
      }}
    >
      <p>
        Destination:{" "}
        <strong>
          {loading ? "Loading folders…" : (folder?.name ?? "Shared with me")}
        </strong>
      </p>
      <section
        className="destination-browser"
        aria-label="Destination folders"
        aria-busy={loading}
      >
        {trail.length > 1 && (
          <button
            className="secondary"
            type="button"
            disabled={loading || busy}
            onClick={() => {
              const parentTrail = trail.slice(0, -1);
              setTrail(parentTrail);
              setTarget(parentTrail.at(-1)?.id);
            }}
          >
            Parent folder
          </button>
        )}
        {!loading &&
          children.map((child) => (
            <button
              className="secondary"
              type="button"
              key={child.id}
              disabled={busy}
              onClick={() => {
                setTrail([...trail, child]);
                setTarget(child.id);
              }}
            >
              {child.name}
            </button>
          ))}
        {!loading && children.length === 0 && (
          <p className="hint">
            {failed
              ? "Folders could not be loaded. Close this dialog and try again."
              : "No subfolders here."}
          </p>
        )}
      </section>
      <DialogActions
        action="Move here"
        busy={busy}
        disabled={!allowed || loading || failed}
        onClose={onClose}
      />
    </form>
  );
}

function DialogActions({
  action,
  busy,
  disabled = false,
  danger = false,
  onClose,
}: Readonly<{
  action: string;
  busy: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClose: () => void;
}>) {
  return (
    <div className="dialog-actions">
      <button className="secondary" onClick={onClose} type="button">
        Cancel
      </button>
      <button
        className={danger ? "danger" : "primary"}
        disabled={busy || disabled}
        type="submit"
      >
        {action}
      </button>
    </div>
  );
}

export function ResourceDialogs({
  error,
  overlay,
  parentId,
  selected,
  details,
  onError,
  csrfToken,
  busy,
  returnFocus,
  mutate,
  onClose,
}: Readonly<{
  error?: string | undefined;
  overlay: Overlay;
  parentId: string | undefined;
  selected: Resource | undefined;
  details: ResourceDetails | undefined;
  onError: (error: unknown) => void;
  csrfToken: string;
  busy: boolean;
  returnFocus: RefObject<HTMLButtonElement | null>;
  mutate: Mutate;
  onClose: () => void;
}>) {
  const [folderName, setFolderName] = useState("");
  const [uploadFile, setUploadFile] = useState<File>();
  const [replaceFile, setReplaceFile] = useState<File>();
  const [shareUser, setShareUser] = useState("user-priya");
  const [shareRole, setShareRole] = useState<"viewer" | "editor">("viewer");

  useEffect(() => {
    if (!overlay) return;
    setFolderName("");
    setUploadFile(undefined);
    setReplaceFile(undefined);
  }, [overlay]);

  function submitFolder(event: FormEvent) {
    event.preventDefault();
    if (!parentId) return;
    mutate(
      () => api.createFolder(parentId, folderName, csrfToken),
      "Folder created.",
    );
  }

  function submitUpload(event: FormEvent) {
    event.preventDefault();
    if (!parentId || !uploadFile) return;
    mutate(() => api.upload(parentId, uploadFile, csrfToken), "File uploaded.");
  }

  if (!overlay) return null;
  if (overlay === "folder") {
    return (
      <Modal
        onClose={onClose}
        returnFocus={returnFocus}
        title="Create folder"
        error={error}
      >
        <form className="dialog-form" onSubmit={submitFolder}>
          <label>
            Folder name
            <input
              autoComplete="off"
              maxLength={120}
              onChange={(event) => setFolderName(event.target.value)}
              required
              value={folderName}
            />
          </label>
          <DialogActions action="Create" busy={busy} onClose={onClose} />
        </form>
      </Modal>
    );
  }
  if (overlay === "upload") {
    return (
      <Modal
        onClose={onClose}
        returnFocus={returnFocus}
        title="Upload file"
        error={error}
      >
        <form className="dialog-form" onSubmit={submitUpload}>
          <label>
            File
            <input
              accept={acceptedFileInput}
              onChange={(event) => setUploadFile(event.target.files?.[0])}
              required
              type="file"
            />
          </label>
          <p className="hint">Maximum 16 MiB.</p>
          <DialogActions
            action="Upload"
            busy={busy}
            disabled={!uploadFile}
            onClose={onClose}
          />
        </form>
      </Modal>
    );
  }
  if (!selected) return null;
  if (overlay === "replace") {
    return (
      <Modal
        onClose={onClose}
        returnFocus={returnFocus}
        title="Replace file"
        error={error}
      >
        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (replaceFile) {
              mutate(
                () => api.replace(selected, replaceFile, csrfToken),
                "File replaced.",
              );
            }
          }}
        >
          <label>
            Replacement
            <input
              accept={`.${selected.name.split(".").at(-1)}`}
              onChange={(event) => setReplaceFile(event.target.files?.[0])}
              required
              type="file"
            />
          </label>
          <DialogActions
            action="Replace"
            busy={busy}
            disabled={!replaceFile}
            onClose={onClose}
          />
        </form>
      </Modal>
    );
  }
  if (overlay === "share") {
    return (
      <Modal
        onClose={onClose}
        returnFocus={returnFocus}
        title="Manage sharing"
        error={error}
      >
        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            mutate(
              () => api.share(selected, shareUser, shareRole, csrfToken),
              "Share updated.",
            );
          }}
        >
          {details?.shares.length ? (
            <div className="current-shares">
              {details.shares.map((share) => (
                <div key={share.userId}>
                  <span>
                    <strong>{share.name}</strong>
                    <small>{share.role}</small>
                  </span>
                  <button
                    aria-label={`Revoke ${share.name} share`}
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      mutate(
                        () => api.revoke(selected, share.userId, csrfToken),
                        "Share revoked.",
                      )
                    }
                    type="button"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <label>
            Person
            <select
              onChange={(event) => setShareUser(event.target.value)}
              value={shareUser}
            >
              <option value="user-priya">Priya</option>
              <option value="user-lee">Lee</option>
            </select>
          </label>
          <label>
            Access
            <select
              onChange={(event) =>
                setShareRole(event.target.value as "viewer" | "editor")
              }
              value={shareRole}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
          </label>
          <DialogActions action="Update share" busy={busy} onClose={onClose} />
        </form>
      </Modal>
    );
  }
  if (overlay === "move") {
    return (
      <Modal
        onClose={onClose}
        returnFocus={returnFocus}
        title="Move resource"
        error={error}
      >
        {details && (
          <MoveDestination
            selected={selected}
            details={details}
            busy={busy}
            csrfToken={csrfToken}
            mutate={mutate}
            onClose={onClose}
            onError={onError}
          />
        )}
      </Modal>
    );
  }
  return (
    <Modal
      onClose={onClose}
      returnFocus={returnFocus}
      title="Delete resource"
      error={error}
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          mutate(() => api.delete(selected, csrfToken), "Resource deleted.");
        }}
      >
        <p>
          Delete <strong>{selected.name}</strong>
          {selected.kind === "folder" ? " and its bounded contents" : ""}?
        </p>
        <DialogActions action="Delete" busy={busy} danger onClose={onClose} />
      </form>
    </Modal>
  );
}
