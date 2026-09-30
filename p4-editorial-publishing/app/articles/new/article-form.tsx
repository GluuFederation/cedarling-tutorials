"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { createArticle } from "@/app/actions.ts";

export function ArticleForm({
  csrfToken,
  allowed,
}: {
  csrfToken: string;
  allowed: boolean;
}) {
  const [state, action, pending] = useActionState(createArticle, {
    error: null,
  });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <form action={action} className="editor-form">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <label>
        Title
        <input
          name="title"
          maxLength={160}
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={!allowed || pending}
        />
      </label>
      <label>
        Body
        <textarea
          name="body"
          rows={9}
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={!allowed || pending}
        />
      </label>
      {state.error && (
        <p className="outcome error" role="alert">
          {state.error}
        </p>
      )}
      {!allowed && (
        <p className="permission-note" id="create-denied">
          This account cannot create an article.
        </p>
      )}
      <div className="action-row">
        <button
          className="primary"
          type="submit"
          disabled={!allowed || pending || !hydrated}
          aria-describedby={!allowed ? "create-denied" : undefined}
        >
          {pending ? "Creating…" : "Create article"}
        </button>
        <Link className="secondary" href="/">
          Cancel
        </Link>
      </div>
    </form>
  );
}
