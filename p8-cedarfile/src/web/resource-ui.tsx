import {
  ArrowLeft,
  ArrowRight,
  DownloadSimple,
  File,
  FileAudio,
  FileImage,
  FilePdf,
  FileText,
  FileVideo,
  Folder,
  FolderPlus,
  PencilSimple,
  ShareNetwork,
  Trash,
  UploadSimple,
} from "./icons.tsx";
import type { Resource, ResourceDetails } from "./types";
import type { Overlay } from "./ResourceDialogs";

export function ResourceIcon({ resource }: Readonly<{ resource: Resource }>) {
  if (resource.kind === "folder")
    return <Folder aria-hidden="true" size={22} weight="fill" />;
  if (resource.mediaType === "application/pdf")
    return <FilePdf aria-hidden="true" size={22} />;
  if (resource.mediaType?.startsWith("image/"))
    return <FileImage aria-hidden="true" size={22} />;
  if (resource.mediaType?.startsWith("audio/"))
    return <FileAudio aria-hidden="true" size={22} />;
  if (resource.mediaType?.startsWith("video/"))
    return <FileVideo aria-hidden="true" size={22} />;
  if (resource.mediaType?.startsWith("text/"))
    return <FileText aria-hidden="true" size={22} />;
  return <File aria-hidden="true" size={22} />;
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

type OpenOverlay = (
  overlay: Exclude<Overlay, null>,
  invoker: HTMLButtonElement,
) => void;

export function ExplorerPane({
  folder,
  resources,
  selectedId,
  loading,
  onOpenOverlay,
  onParent,
  onSelect,
}: Readonly<{
  folder: Resource | null;
  resources: Resource[];
  selectedId: string | undefined;
  loading: boolean;
  onOpenOverlay: OpenOverlay;
  onParent: (id?: string) => void;
  onSelect: (resource: Resource) => void;
}>) {
  return (
    <section className="explorer" aria-label="File explorer">
      <div className="explorer-head">
        <div>
          <h2>{folder?.name ?? "Shared with me"}</h2>
          <small>{resources.length} resources</small>
        </div>
        <div className="head-actions">
          <button
            aria-label="Create folder"
            className="icon-button"
            disabled={!folder}
            onClick={(event) => onOpenOverlay("folder", event.currentTarget)}
            type="button"
          >
            <FolderPlus size={20} />
          </button>
          <button
            aria-label="Upload file"
            className="primary compact"
            disabled={!folder}
            onClick={(event) => onOpenOverlay("upload", event.currentTarget)}
            type="button"
          >
            <UploadSimple size={18} />
            Upload
          </button>
        </div>
      </div>
      {folder?.parentId && (
        <button
          className="back-row"
          onClick={() => onParent(folder.parentId ?? undefined)}
          type="button"
        >
          <ArrowLeft size={18} />
          Parent folder
        </button>
      )}
      <div className="resource-list" aria-busy={loading}>
        {loading && <p className="state">Loading resources…</p>}
        {!loading && resources.length === 0 && (
          <p className="state">This folder is empty.</p>
        )}
        {resources.map((resource) => (
          <button
            className={`resource-row ${selectedId === resource.id ? "active" : ""}`}
            key={resource.id}
            onClick={() => onSelect(resource)}
            type="button"
          >
            <ResourceIcon resource={resource} />
            <span className="resource-name">
              <strong>{resource.name}</strong>
              <small>
                {resource.access} · {resource.kind}
              </small>
            </span>
            <span className="resource-size">{formatSize(resource.size)}</span>
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        ))}
      </div>
    </section>
  );
}

export function ResourceDetailsPane({
  selectedId,
  details,
  detailLoading,
  busy,
  folders,
  previewUrl,
  text,
  onBack,
  onOpenFolder,
  onOpenOverlay,
  onSaveText,
  onTextChange,
}: Readonly<{
  selectedId: string | undefined;
  details: ResourceDetails | undefined;
  detailLoading: boolean;
  busy: boolean;
  folders: Resource[];
  previewUrl: string | undefined;
  text: string;
  onBack: () => void;
  onOpenFolder: (id: string) => void;
  onOpenOverlay: OpenOverlay;
  onSaveText: () => void;
  onTextChange: (value: string) => void;
}>) {
  const selected = details?.resource;
  return (
    <section
      className={`detail ${selectedId ? "mobile-active" : ""}`}
      aria-label="Selected resource"
    >
      {!selectedId && (
        <div className="detail-empty">
          <File size={32} />
          <h2>Select a file</h2>
          <p>Preview content and run a file operation.</p>
        </div>
      )}
      {selectedId && detailLoading && (
        <p className="state">Loading resource…</p>
      )}
      {selected && (
        <>
          <div className="detail-head">
            <button className="mobile-back" onClick={onBack} type="button">
              <ArrowLeft size={18} />
              Files
            </button>
            <div className="detail-title">
              <ResourceIcon resource={selected} />
              <div>
                <h2>{selected.name}</h2>
                <small>
                  {selected.mediaType ?? "Folder"} · {formatSize(selected.size)}{" "}
                  · v{selected.version}
                </small>
              </div>
            </div>
            <span className={`access ${selected.access}`}>
              {selected.access}
            </span>
          </div>
          <div className="detail-scroll">
            <nav className="breadcrumbs" aria-label="Resource path">
              {details.breadcrumbs.map((item) => (
                <span key={item.id}>/{item.name}</span>
              ))}
            </nav>
            {selected.kind === "file" && (
              <section className="preview" aria-label="File preview">
                {selected.mediaType?.startsWith("text/") && (
                  <textarea
                    aria-label="Text content"
                    onChange={(event) => onTextChange(event.target.value)}
                    value={text}
                  />
                )}
                {selected.mediaType?.startsWith("image/") && previewUrl && (
                  <img alt={selected.name} src={previewUrl} />
                )}
                {selected.mediaType?.startsWith("audio/") && previewUrl && (
                  <audio controls src={previewUrl}>
                    <track kind="captions" />
                  </audio>
                )}
                {selected.mediaType?.startsWith("video/") && previewUrl && (
                  <video controls src={previewUrl}>
                    <track kind="captions" />
                  </video>
                )}
                {selected.mediaType === "application/pdf" && previewUrl && (
                  <a
                    className="preview-link"
                    href={previewUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <FilePdf size={24} />
                    Open PDF
                  </a>
                )}
              </section>
            )}
            <dl className="metadata">
              <div>
                <dt>Workspace</dt>
                <dd>{selected.workspaceId}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{selected.ownerId}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{new Date(selected.updatedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Shares</dt>
                <dd>
                  {details.shares.length
                    ? details.shares
                        .map((share) => `${share.name} (${share.role})`)
                        .join(", ")
                    : "None"}
                </dd>
              </div>
            </dl>
          </div>
          <div className="detail-actions">
            {selected.kind === "folder" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => onOpenFolder(selected.id)}
                type="button"
              >
                <Folder size={18} />
                Open folder
              </button>
            )}
            {selected.mediaType?.startsWith("text/") && (
              <button
                className="primary"
                disabled={busy}
                onClick={onSaveText}
                type="button"
              >
                <PencilSimple size={18} />
                Save
              </button>
            )}
            {selected.kind === "file" && (
              <a
                className="secondary button-link"
                href={`/api/resources/${selected.id}/content?download=1`}
              >
                <DownloadSimple size={18} />
                Download
              </a>
            )}
            {selected.kind === "file" && (
              <button
                className="secondary"
                disabled={busy}
                onClick={(event) =>
                  onOpenOverlay("replace", event.currentTarget)
                }
                type="button"
              >
                <UploadSimple size={18} />
                Replace
              </button>
            )}
            <button
              className="secondary"
              disabled={busy}
              onClick={(event) => onOpenOverlay("share", event.currentTarget)}
              type="button"
            >
              <ShareNetwork size={18} />
              Share
            </button>
            <button
              className="secondary"
              disabled={busy || folders.length === 0}
              onClick={(event) => onOpenOverlay("move", event.currentTarget)}
              type="button"
            >
              <Folder size={18} />
              Move
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={(event) => onOpenOverlay("delete", event.currentTarget)}
              type="button"
            >
              <Trash size={18} />
              Delete
            </button>
          </div>
        </>
      )}
    </section>
  );
}
