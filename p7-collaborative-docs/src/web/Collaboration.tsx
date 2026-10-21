import type { Dispatch, SetStateAction } from "react";
import type { DocumentDetail, DocumentRole } from "../shared/types.ts";
export type CollaborationTab = "comments" | "access";
export function Collaboration({
  detail,
  busy,
  tab,
  comment,
  setComment,
  setCommentIdempotencyKey,
  addComment,
  changeAccess,
  removeAccess,
  candidate,
  setCandidate,
  role,
  setRole,
}: Readonly<{
  detail: DocumentDetail;
  busy: boolean;
  tab: CollaborationTab;
  comment: string;
  setComment: Dispatch<SetStateAction<string>>;
  setCommentIdempotencyKey: Dispatch<SetStateAction<string>>;
  addComment: () => void;
  changeAccess: (id: string, role: Exclude<DocumentRole, "owner">) => void;
  removeAccess: (id: string) => void;
  candidate: string;
  setCandidate: Dispatch<SetStateAction<string>>;
  role: Exclude<DocumentRole, "owner">;
  setRole: Dispatch<SetStateAction<Exclude<DocumentRole, "owner">>>;
}>) {
  const unusedCandidates = detail.candidates.filter(
    (user) => !detail.members.some((member) => member.userId === user.id),
  );
  return (
    <div className="side-stack">
      <section
        id="comments-panel"
        role="tabpanel"
        aria-labelledby="comments-tab"
        hidden={tab !== "comments"}
        className="compact-card"
      >
        <h3>Comments</h3>
        {detail.hasOlderComments && (
          <p className="comment-window">
            Showing the latest 50 comments. Older comments remain saved.
          </p>
        )}
        <div className="comments">
          {detail.comments.map((item) => (
            <article key={item.id}>
              <strong>{item.authorName}</strong>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            addComment();
          }}
        >
          <label>
            Add comment
            <textarea
              disabled={busy}
              maxLength={1_000}
              rows={2}
              value={comment}
              onChange={(event) => {
                setComment(event.target.value);
                setCommentIdempotencyKey(crypto.randomUUID());
              }}
            />
          </label>
          <button
            className="secondary"
            disabled={busy || !comment.trim() || !detail.actions.comment}
            type="submit"
          >
            Comment
          </button>
        </form>
      </section>
      <section
        id="access-panel"
        role="tabpanel"
        aria-labelledby="access-tab"
        hidden={tab !== "access"}
        className="compact-card"
      >
        <h3>Access</h3>
        <div className="members">
          {detail.members.map((member) => (
            <div key={member.userId} className="member">
              <span>
                <strong>{member.name}</strong>
                <small>{member.role}</small>
              </span>
              {member.role !== "owner" && (
                <span className="member-actions">
                  <select
                    aria-label={`Role for ${member.name}`}
                    value={member.role}
                    disabled={busy || !detail.actions.manageAccess}
                    onChange={(event) =>
                      changeAccess(
                        member.userId,
                        event.target.value as Exclude<DocumentRole, "owner">,
                      )
                    }
                  >
                    <option value="editor">Editor</option>
                    <option value="commenter">Commenter</option>
                  </select>
                  <button
                    aria-label={`Remove ${member.name}`}
                    className="text-danger"
                    type="button"
                    disabled={busy || !detail.actions.manageAccess}
                    onClick={() => removeAccess(member.userId)}
                  >
                    Remove
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
        {unusedCandidates.length > 0 && (
          <div className="share-row">
            <select
              aria-label="Collaborator"
              value={candidate}
              onChange={(event) => setCandidate(event.target.value)}
            >
              <option value="">Choose collaborator</option>
              {unusedCandidates.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Access role"
              value={role}
              onChange={(event) =>
                setRole(event.target.value as Exclude<DocumentRole, "owner">)
              }
            >
              <option value="editor">Editor</option>
              <option value="commenter">Commenter</option>
            </select>
            <button
              className="secondary"
              type="button"
              disabled={busy || !candidate || !detail.actions.manageAccess}
              onClick={() => changeAccess(candidate, role)}
            >
              Share
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
