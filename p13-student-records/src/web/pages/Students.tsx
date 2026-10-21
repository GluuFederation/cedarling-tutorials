import {
  Link,
  NavLink,
  Outlet,
  useLoaderData,
  useRouteLoaderData,
  useSearchParams,
} from "react-router";
import type { StudentProfile, StudentSummary } from "../../shared/contracts.ts";
import {
  BackLink,
  calendarDate,
  Facts,
  PageHeading,
  Status,
} from "../components/Feedback.tsx";
import { Avatar } from "../components/Shell.tsx";
export function Students() {
  const { students } = useLoaderData<{ students: StudentSummary[] }>();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const className = params.get("class") ?? "";
  const state = params.get("status") ?? "";
  const filtered = students.filter(
    (s) =>
      `${s.name} ${s.studentNumber}`.toLowerCase().includes(q.toLowerCase()) &&
      (!className || s.className === className) &&
      (!state || s.enrollmentStatus === state),
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
        title="Students"
        description="Open a student record to review enrollment and results."
      />
      <div className="filters">
        <label className="search">
          Find a student
          <input
            type="search"
            value={q}
            placeholder="Name or student number"
            onChange={(e) => filter("q", e.target.value)}
          />
        </label>
        <label>
          Class
          <select
            value={className}
            onChange={(e) => filter("class", e.target.value)}
          >
            <option value="">All classes</option>
            {[...new Set(students.map((s) => s.className))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Enrollment
          <select
            value={state}
            onChange={(e) => filter("status", e.target.value)}
          >
            <option value="">All enrollments</option>
            <option>Active</option>
            <option>Withdrawn</option>
          </select>
        </label>
      </div>
      <p className="result-count" role="status">
        {filtered.length} {filtered.length === 1 ? "student" : "students"}
      </p>
      <div className="table-scroll">
        <table className="directory">
          <caption className="sr-only">Student directory</caption>
          <thead>
            <tr>
              <th>Student</th>
              <th>Class</th>
              <th className="hide-narrow">Year group</th>
              <th>Enrollment</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link
                    className="person-link"
                    to={
                      "/students/" +
                      s.id +
                      (params.size
                        ? `?from=${encodeURIComponent(params.toString())}`
                        : "")
                    }
                  >
                    <Avatar name={s.name} />
                    <span>
                      <strong>{s.name}</strong>
                      <small>{s.studentNumber}</small>
                    </span>
                  </Link>
                </td>
                <td>{s.className}</td>
                <td className="hide-narrow">{s.yearGroup}</td>
                <td>
                  <Status value={s.enrollmentStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <h3>No students match these filters</h3>
          <button
            className="secondary"
            type="button"
            onClick={() => setParams({})}
          >
            Clear filters
          </button>
        </div>
      )}
    </section>
  );
}
export function Student() {
  const student = useLoaderData<StudentProfile>();
  const [params] = useSearchParams();
  const from = params.get("from");
  const query = from ? `?from=${encodeURIComponent(from)}` : "";
  return (
    <article className="page record-page">
      <BackLink
        to={`/students${from ? `?${new URLSearchParams(from).toString()}` : ""}`}
      >
        Back to students
      </BackLink>
      <div className="record-header">
        <Avatar name={student.name} large />
        <div>
          <h2 tabIndex={-1}>{student.name}</h2>
          <p>
            {student.studentNumber +
              " · " +
              student.yearGroup +
              " · " +
              student.className}
          </p>
          <small>{student.academicYear}</small>
        </div>
        <div className="record-header-actions">
          <Status value={student.enrollmentStatus} />
          <Link className="primary" to={`/gradebook?studentId=${student.id}`}>
            Open gradebook
          </Link>
        </div>
      </div>
      <nav className="record-tabs" aria-label="Student record">
        <NavLink end to={`.${query}`}>
          Overview
        </NavLink>
        <NavLink to={`results/student${query}`}>Student results</NavLink>
        <NavLink to={`results/guardian${query}`}>Guardian results</NavLink>
      </nav>
      <Outlet />
    </article>
  );
}
export function Overview() {
  const s = useRouteLoaderData<StudentProfile>("student");
  if (!s) return null;
  return (
    <>
      <section className="record-section">
        <h3>School profile</h3>
        <Facts
          items={[
            ["Full name", s.name],
            ["Preferred name", s.preferredName],
            ["Student number", s.studentNumber],
            ["Year group", s.yearGroup],
            ["Class", s.className],
            ["Academic year", s.academicYear],
            ["Admitted", calendarDate(s.admittedOn)],
          ]}
        />
      </section>
      <section className="record-section">
        <h3>Course enrollment</h3>
        <ul className="enrollment-list">
          {s.enrollments.map((e) => (
            <li key={e.courseId}>
              <span>{e.course}</span>
              <Status value={e.state === "active" ? "Active" : "Withdrawn"} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
