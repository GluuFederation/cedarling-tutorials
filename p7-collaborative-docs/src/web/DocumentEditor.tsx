import type { DocumentDetail } from "../shared/types.ts";

export function DocumentEditor({
  detail,
  title,
  content,
  busy,
  dirty,
  onTitle,
  onContent,
  save,
}: Readonly<{
  detail: DocumentDetail;
  title: string;
  content: string;
  busy: boolean;
  dirty: boolean;
  onTitle: (value: string) => void;
  onContent: (value: string) => void;
  save: () => void;
}>) {
  return (
    <section className="editor-card">
      <label>
        Title
        <input
          maxLength={100}
          value={title}
          disabled={busy}
          onChange={(event) => {
            onTitle(event.target.value);
          }}
        />
      </label>
      <label>
        Document
        <textarea
          maxLength={20_000}
          rows={13}
          value={content}
          disabled={busy}
          onChange={(event) => {
            onContent(event.target.value);
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
  );
}
