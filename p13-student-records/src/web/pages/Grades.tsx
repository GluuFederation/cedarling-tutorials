import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  Link,
  useBeforeUnload,
  useBlocker,
  useFetcher,
  useFetchers,
  useLoaderData,
  useParams,
  useRevalidator,
  useRouteError,
  useRouteLoaderData,
  useSearchParams,
} from "react-router";
import type {
  GradeView,
  Publication,
  StudentProfile,
} from "../../shared/contracts.ts";
import { ApiError } from "../api.ts";
import {
  BackLink,
  date,
  Facts,
  Notice,
  PageHeading,
  Status,
} from "../components/Feedback.tsx";
import { Avatar } from "../components/Shell.tsx";
export type GradeActionData = {
  saved?: GradeView;
  published?: Publication;
  message?: string;
  code?: string;
};
export function Gradebook() {
  const { grades } = useLoaderData<{ grades: GradeView[] }>();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const filtered = grades.filter(({ grade }) =>
    (
      grade.course +
      " " +
      grade.assessment +
      ("studentName" in grade ? ` ${grade.studentName}` : "")
    )
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  return (
    <section className="page">
      <PageHeading
        title="Gradebook"
        description="Save assessment drafts, then publish the completed grades."
      />
      <div className="filters">
        <label className="search">
          Find a grade
          <input
            type="search"
            value={q}
            placeholder="Student, course or assessment"
            onChange={(e) => filter("q", e.target.value)}
          />
        </label>
        <label>
          Course
          <select
            value={params.get("courseId") ?? ""}
            onChange={(e) => filter("courseId", e.target.value)}
          >
            <option value="">All courses</option>
            <option value="algebra">Algebra</option>
            <option value="biology">Biology</option>
          </select>
        </label>
        <label>
          Publication
          <select
            value={params.get("state") ?? ""}
            onChange={(e) => filter("state", e.target.value)}
          >
            <option value="">All grades</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </label>
      </div>
      {params.get("studentId") && (
        <p>
          <Link to="/gradebook">Show every student</Link>
        </p>
      )}
      <p className="result-count" role="status">
        {filtered.length} {filtered.length === 1 ? "grade" : "grades"}
      </p>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Assessment grades</caption>
          <thead>
            <tr>
              <th>Student</th>
              <th>Assessment</th>
              <th className="hide-narrow">Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ id, grade }) => (
              <tr key={id}>
                <td>
                  <Link
                    className="person-link"
                    to={
                      "/gradebook/" +
                      id +
                      (params.size
                        ? `?from=${encodeURIComponent(params.toString())}`
                        : "")
                    }
                  >
                    <Avatar
                      name={
                        "studentName" in grade ? grade.studentName : "Student"
                      }
                    />
                    <span>
                      <strong>
                        {"studentName" in grade ? grade.studentName : "Student"}
                      </strong>
                      <small>{grade.course}</small>
                    </span>
                  </Link>
                </td>
                <td>{grade.assessment}</td>
                <td className="hide-narrow">
                  {"score" in grade
                    ? (grade.score ?? "Not recorded")
                    : "Not recorded"}
                </td>
                <td>
                  <Status value={grade.publishedAt ? "published" : "draft"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <h3>No grades match these filters</h3>
          <button
            type="button"
            className="secondary"
            onClick={() => setParams({})}
          >
            Clear filters
          </button>
        </div>
      )}
    </section>
  );
}
export function Results() {
  const { grades } = useLoaderData<{ grades: GradeView[] }>();
  const { audience } = useParams();
  return (
    <section className="record-section">
      <h3>
        {audience === "guardian" ? "Guardian results" : "Student results"}
      </h3>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">
            {audience === "guardian" ? "Guardian results" : "Student results"}
          </caption>
          <thead>
            <tr>
              <th>Assessment</th>
              <th>Grade</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {grades.map(({ id, grade }) => (
              <tr key={id}>
                <td>
                  <Link to={id}>{`${grade.course} · ${grade.assessment}`}</Link>
                </td>
                <td>
                  {"letterGrade" in grade
                    ? (grade.letterGrade ?? "Not recorded")
                    : "Not recorded"}
                </td>
                <td>
                  <Status value={grade.publishedAt ? "published" : "draft"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!grades.length && <p>No results are available for this view.</p>}
    </section>
  );
}
export function Result() {
  const { grade } = useLoaderData<GradeView>();
  const { audience } = useParams();
  const s = useRouteLoaderData<StudentProfile>("student");
  const items: [string, ReactNode][] = [];
  if ("score" in grade) items.push(["Score", grade.score ?? "Not recorded"]);
  if ("letterGrade" in grade)
    items.push(["Grade", grade.letterGrade ?? "Not recorded"]);
  if ("feedback" in grade)
    items.push(["Student feedback", grade.feedback || "Not recorded"]);
  items.push([
    "Published",
    grade.publishedAt ? date(Date.parse(grade.publishedAt)) : "Not published",
  ]);
  return (
    <section className="record-section">
      <BackLink to={`/students/${s?.id}/results/${audience}`}>
        Back to results
      </BackLink>
      <PageHeading title={`${grade.course} · ${grade.assessment}`}>
        <Status value={grade.publishedAt ? "published" : "draft"} />
      </PageHeading>
      <Facts items={items} />
    </section>
  );
}
export function Editor() {
  const loaded = useLoaderData<GradeView>();
  const fetcher = useFetcher<GradeActionData>();
  const [params] = useSearchParams();
  const view =
    fetcher.data?.saved &&
    fetcher.data.saved.grade.version >= loaded.grade.version
      ? fetcher.data.saved
      : loaded;
  const grade = "internalNote" in view.grade ? view.grade : undefined;
  if (!grade) throw new Error("The gradebook requires a teacher projection");
  const [score, setScore] = useState(grade.score?.toString() ?? "");
  const [feedback, setFeedback] = useState(grade.feedback);
  const [note, setNote] = useState(grade.internalNote);
  const busy = fetcher.state !== "idle";
  const requiresReload =
    fetcher.data?.code === "CONFLICT" ||
    fetcher.data?.code === "REQUEST_UNCONFIRMED";
  const publishing = fetcher.formData?.get("intent") === "publish";
  const dirty =
    grade.state === "draft" &&
    (score !== (grade.score?.toString() ?? "") ||
      feedback !== grade.feedback ||
      note !== grade.internalNote);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      Boolean(dirty) &&
      !busy &&
      currentLocation.pathname !== nextLocation.pathname &&
      nextLocation.pathname !== "/sign-out",
  );
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm("Discard your unsaved grade changes?"))
        blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (dirty) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      [dirty],
    ),
  );
  const complete =
    score.trim() !== "" &&
    Number.isInteger(Number(score)) &&
    Number(score) >= 0 &&
    Number(score) <= 100 &&
    Boolean(feedback.trim());
  function submit(event: FormEvent<HTMLFormElement>) {
    const button = (event.nativeEvent as SubmitEvent).submitter;
    if (
      button instanceof HTMLButtonElement &&
      button.value === "publish" &&
      !window.confirm("Publish this grade? Published grades cannot be edited.")
    )
      event.preventDefault();
  }
  const from = params.get("from");
  return (
    <article className="page record-page">
      <BackLink
        to={
          "/gradebook" +
          (from ? `?${new URLSearchParams(from).toString()}` : "")
        }
      >
        Back to gradebook
      </BackLink>
      <PageHeading
        title={`${grade.course} · ${grade.assessment}`}
        description={grade.studentName}
      >
        <Status value={grade.state} />
      </PageHeading>
      {(fetcher.data?.saved || fetcher.data?.published) && (
        <Notice
          key={view.grade.version}
          message={fetcher.data.published ? "Grade published." : "Draft saved."}
        />
      )}
      {grade.state === "draft" ? (
        <fetcher.Form method="post" className="grade-form" onSubmit={submit}>
          <input type="hidden" name="expectedVersion" value={grade.version} />
          <label>
            Score
            <input
              name="score"
              type="number"
              min={0}
              max={100}
              step={1}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              disabled={busy}
            />
            <small>Out of 100</small>
          </label>
          <label>
            Student feedback
            <textarea
              name="feedback"
              rows={3}
              maxLength={2000}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Private teacher note
            <textarea
              name="internalNote"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
            />
          </label>
          {dirty && (
            <p className="hint" role="status">
              Unsaved changes. Save the draft before publishing.
            </p>
          )}
          {fetcher.data?.message && (
            <p className="form-error" role="alert">
              {fetcher.data.message}
            </p>
          )}
          <div className="form-actions">
            <button
              type="submit"
              name="intent"
              value="save"
              className="secondary"
              disabled={busy || requiresReload || !dirty}
            >
              {busy && !publishing ? "Saving…" : "Save draft"}
            </button>
            <button
              type="submit"
              name="intent"
              value="publish"
              className="primary"
              disabled={busy || requiresReload || Boolean(dirty) || !complete}
            >
              {busy && publishing ? "Publishing…" : "Publish grade"}
            </button>
          </div>
          {requiresReload && (
            <Link reloadDocument to="." className="secondary">
              Reload the current grade
            </Link>
          )}
        </fetcher.Form>
      ) : (
        <section className="record-section">
          <h3>Published result</h3>
          <Facts
            items={[
              ["Score", grade.score],
              ["Student feedback", grade.feedback],
              ["Private teacher note", grade.internalNote || "Not recorded"],
              [
                "Published",
                grade.publishedAt
                  ? date(Date.parse(grade.publishedAt))
                  : "Not published",
              ],
            ]}
          />
          <p className="muted">This published grade is read-only.</p>
        </section>
      )}
      <div className="record-actions">
        <Link to={`/students/${grade.studentId}`}>Open student record</Link>
      </div>
    </article>
  );
}
export function RecordError() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  const fetchers = useFetchers();
  if (error instanceof ApiError && error.status === 401) throw error;
  const committed = fetchers.some((f) => f.data?.saved || f.data?.published);
  return (
    <section className="page">
      <h2>Record unavailable</h2>
      {committed && (
        <p role="status">
          Your grade change was accepted, but the refreshed record could not be
          loaded. Reload to check its current state.
        </p>
      )}
      <p role="alert">
        {error instanceof ApiError
          ? error.message
          : "The record could not be loaded. Try again."}
      </p>
      <button
        type="button"
        className="secondary"
        onClick={() => void revalidator.revalidate()}
      >
        Reload record
      </button>
      <Link to="/students">Return to students</Link>
    </section>
  );
}
