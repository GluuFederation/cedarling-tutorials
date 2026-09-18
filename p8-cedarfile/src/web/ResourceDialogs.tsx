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
  overlay,
  parentId,
  selected,
  details,
  folders,
  csrfToken,
  busy,
  returnFocus,
  mutate,
  onClose,
}: Readonly<{
  overlay: Overlay;
  parentId: string | undefined;
  selected: Resource | undefined;
  details: ResourceDetails | undefined;
  folders: Resource[];
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
  const [destinationId, setDestinationId] = useState("");

  useEffect(() => {
    if (!overlay) return;
    setFolderName("");
    setUploadFile(undefined);
    setReplaceFile(undefined);
    if (overlay === "move") setDestinationId(folders[0]?.id ?? "");
  }, [folders, overlay]);

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
      <Modal onClose={onClose} returnFocus={returnFocus} title="Create folder">
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
      <Modal onClose={onClose} returnFocus={returnFocus} title="Upload file">
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
      <Modal onClose={onClose} returnFocus={returnFocus} title="Replace file">
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
      <Modal onClose={onClose} returnFocus={returnFocus} title="Manage sharing">
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
      <Modal onClose={onClose} returnFocus={returnFocus} title="Move resource">
        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            mutate(
              () => api.move(selected, destinationId, csrfToken),
              "Resource moved.",
            );
          }}
        >
          <label>
            Destination
            <select
              onChange={(event) => setDestinationId(event.target.value)}
              required
              value={destinationId}
            >
              {folders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <DialogActions
            action="Move"
            busy={busy}
            disabled={!destinationId}
            onClose={onClose}
          />
        </form>
      </Modal>
    );
  }
  return (
    <Modal onClose={onClose} returnFocus={returnFocus} title="Delete resource">
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
