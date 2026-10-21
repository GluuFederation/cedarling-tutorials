import type { Dispatch, SetStateAction } from "react";
import { Modal } from "./Modal.tsx";
export function CreateDocument({
  open,
  close,
  busy,
  newDocument,
  setNewDocument,
  create,
}: Readonly<{
  open: boolean;
  close: () => void;
  busy: boolean;
  newDocument: { title: string; content: string };
  setNewDocument: Dispatch<SetStateAction<{ title: string; content: string }>>;
  create: () => void;
}>) {
  return (
    <Modal open={open} close={close} label="New document">
      <div className="modal-heading">
        <h2>New document</h2>
        <button
          type="button"
          onClick={close}
          disabled={busy}
          aria-label="Close new document"
        >
          Close
        </button>
      </div>
      <form
        className="compact-form"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <label>
          Title
          <input
            required
            disabled={busy}
            maxLength={100}
            value={newDocument.title}
            onChange={(event) =>
              setNewDocument((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Starting text
          <textarea
            required
            disabled={busy}
            maxLength={20_000}
            rows={4}
            value={newDocument.content}
            onChange={(event) =>
              setNewDocument((current) => ({
                ...current,
                content: event.target.value,
              }))
            }
          />
        </label>
        <button className="primary" disabled={busy} type="submit">
          Create
        </button>
      </form>
    </Modal>
  );
}
