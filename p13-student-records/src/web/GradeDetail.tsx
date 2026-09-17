import { type ReactNode, useState } from "react";
import type { DraftInput, GradeView } from "../shared/contracts.ts";

export function GradeDetail({
  view,
  busy,
  onSave,
  onPublish,
  back,
}: {
  view: GradeView;
  busy: boolean;
  onSave: (input: DraftInput) => Promise<void>;
  onPublish: () => Promise<void>;
  back?: ReactNode;
}) {
  const { grade } = view;
  const teacher = "internalNote" in grade ? grade : undefined;
  const [score, setScore] = useState(teacher?.score?.toString() ?? "");
  const [feedback, setFeedback] = useState(teacher?.feedback ?? "");
  const [note, setNote] = useState(teacher?.internalNote ?? "");
  const dirty =
    teacher &&
    (score !== (teacher.score?.toString() ?? "") ||
      feedback !== teacher.feedback ||
      note !== teacher.internalNote);
  const complete =
    score.trim() !== "" &&
    Number.isInteger(Number(score)) &&
    Number(score) >= 0 &&
    Number(score) <= 100 &&
    Boolean(feedback.trim());
  return (
    <>
      <div className="grade-titlebar">
        {back}
        <div className="detail-heading">
          <h2>
            {grade.course} · {grade.assessment}
          </h2>
          <span
            className={`status ${grade.publishedAt ? "published" : "draft"}`}
          >
            {grade.publishedAt ? "Published" : "Draft"}
          </span>
        </div>
      </div>
      {teacher && (
        <p className="student-name">Student: {teacher.studentName}</p>
      )}
      {teacher?.state === "draft" ? (
        <form
          className="grade-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave({
              expectedVersion: grade.version,
              score: score === "" ? null : Number(score),
              feedback,
              internalNote: note,
            });
          }}
        >
          <label>
            Score
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={score}
              onChange={(event) => setScore(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Student feedback
            <textarea
              rows={4}
              maxLength={2000}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Private teacher note
            <textarea
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy}
            />
          </label>
          <div className="actions">
            <button
              className="secondary"
              type="submit"
              disabled={busy || !dirty}
            >
              Save draft
            </button>
            <button
              className="primary"
              type="button"
              disabled={busy || Boolean(dirty) || !complete}
              onClick={() => void onPublish()}
            >
              Publish grade
            </button>
          </div>
          {dirty && <p className="hint">Save changes before publishing.</p>}
        </form>
      ) : (
        <dl className="grade-facts">
          {"score" in grade && (
            <div>
              <dt>Score</dt>
              <dd>{grade.score ?? "Not recorded"}</dd>
            </div>
          )}
          {"letterGrade" in grade && (
            <div>
              <dt>Grade</dt>
              <dd>{grade.letterGrade ?? "Not recorded"}</dd>
            </div>
          )}
          {"feedback" in grade && (
            <div>
              <dt>Student feedback</dt>
              <dd>{grade.feedback || "Not recorded"}</dd>
            </div>
          )}
          {teacher && (
            <div>
              <dt>Private teacher note</dt>
              <dd>{teacher.internalNote || "Not recorded"}</dd>
            </div>
          )}
          {grade.publishedAt && (
            <div>
              <dt>Published</dt>
              <dd>
                <time dateTime={grade.publishedAt}>
                  {new Date(grade.publishedAt).toLocaleString()}
                </time>
              </dd>
            </div>
          )}
        </dl>
      )}
    </>
  );
}
