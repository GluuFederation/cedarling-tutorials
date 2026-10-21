import {
  Link,
  NavLink,
  Outlet,
  useLoaderData,
  useLocation,
  useRouteLoaderData,
  useSearchParams,
} from "react-router";
import type {
  Contact,
  Medical,
  MedicalEntry,
  Profile,
} from "../../shared/contracts.ts";
import {
  BackLink,
  calendarDate,
  Facts,
  PageHeading,
  Status,
} from "../components/Feedback.tsx";
import { Avatar } from "../components/Shell.tsx";

export function Employees() {
  const employees = useLoaderData<Profile[]>();
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const team = params.get("department") ?? "";
  const status = params.get("status") ?? "";
  const filtered = employees.filter(
    (person) =>
      (!team || person.team === team) &&
      (!status || person.employmentStatus === status) &&
      [person.name, person.employeeNumber].some((value) =>
        value.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  const back = params.size
    ? `?from=${encodeURIComponent(params.toString())}`
    : "";
  return (
    <section className="page">
      <PageHeading
        title="Employees"
        description="Find a colleague, open their record, or request temporary access."
      />
      <div className="filters">
        <label className="search">
          Find an employee
          <input
            type="search"
            value={search}
            onChange={(event) => filter("q", event.target.value)}
            placeholder="Name or employee number"
          />
        </label>
        <label>
          Department
          <select
            value={team}
            onChange={(event) => filter("department", event.target.value)}
          >
            <option value="">All departments</option>
            {[...new Set(employees.map((person) => person.team))]
              .sort()
              .map((value) => (
                <option key={value}>{value}</option>
              ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => filter("status", event.target.value)}
          >
            <option value="">All statuses</option>
            <option>Active</option>
            <option>On leave</option>
          </select>
        </label>
      </div>
      <p className="result-count" role="status">
        {filtered.length} {filtered.length === 1 ? "employee" : "employees"}
      </p>
      <div className="table-scroll">
        <table className="directory">
          <caption className="sr-only">Employee directory</caption>
          <thead>
            <tr>
              <th>Employee</th>
              <th className="hide-narrow">Department</th>
              <th className="hide-medium">Location</th>
              <th className="hide-narrow">Manager</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((person) => (
              <tr key={person.id}>
                <td>
                  <Link
                    className="person-link"
                    to={`/employees/${person.id}${back}`}
                  >
                    <Avatar name={person.name} />
                    <span>
                      <strong>{person.name}</strong>
                      <small>
                        {person.employeeNumber} · {person.jobTitle}
                      </small>
                    </span>
                  </Link>
                </td>
                <td className="hide-narrow">{person.team}</td>
                <td className="hide-medium">{person.office}</td>
                <td className="hide-narrow">{person.managerName}</td>
                <td>
                  <Status value={person.employmentStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <h3>No employees match these filters</h3>
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
export function Employee() {
  const person = useLoaderData<Profile>();
  const { pathname } = useLocation();
  const packageId = pathname.endsWith("/medical")
    ? "occupational-health"
    : "team-support";
  const [params] = useSearchParams();
  const origin = params.get("from");
  const query = origin ? `?from=${encodeURIComponent(origin)}` : "";
  return (
    <article className="page record-page">
      <BackLink
        to={
          "/employees" +
          (origin ? `?${new URLSearchParams(origin).toString()}` : "")
        }
      >
        Back to employees
      </BackLink>
      <div className="record-header">
        <Avatar name={person.name} large />
        <div>
          <h2 tabIndex={-1}>{person.name}</h2>
          <p>
            {person.jobTitle} · {person.team}
          </p>
          <small>
            {person.employeeNumber} · {person.office}
          </small>
        </div>
        <div className="record-header-actions">
          <Status value={person.employmentStatus} />
          <Link
            className="primary"
            to={`/access-requests/new?employee=${person.id}&package=${packageId}`}
          >
            Request access
          </Link>
        </div>
      </div>
      <nav className="record-tabs" aria-label="Employee record">
        <NavLink end to={`.${query}`}>
          Profile
        </NavLink>
        <NavLink to={`contact${query}`}>Contact</NavLink>
        <NavLink to={`medical${query}`}>Medical</NavLink>
      </nav>
      <Outlet />
    </article>
  );
}
export function ProfileFields() {
  const person = useRouteLoaderData<Profile>("employee");
  if (!person) return null;
  return (
    <section className="record-section">
      <h3>Employment details</h3>
      <Facts
        items={[
          ["Full name", person.name],
          ["Preferred name", person.preferredName],
          ["Employee number", person.employeeNumber],
          ["Department", person.team],
          ["Job title", person.jobTitle],
          ["Manager", person.managerName],
          ["Location", person.office],
          ["Employment type", person.employmentType],
          ["Start date", calendarDate(person.startDate)],
        ]}
      />
    </section>
  );
}
export function ContactFields() {
  const contact = useLoaderData<Contact>();
  return (
    <>
      <section className="record-section">
        <h3>Contact details</h3>
        <Facts
          items={[
            ["Work email", contact.workEmail],
            ["Work phone", contact.workPhone],
            ["Personal email", contact.personalEmail],
            ["Mobile", contact.mobilePhone],
            ["Home address", contact.address],
          ]}
        />
      </section>
      <section className="record-section">
        <h3>Emergency contact</h3>
        <Facts
          items={[
            ["Name", contact.emergencyName],
            ["Relationship", contact.emergencyRelationship],
            ["Phone", contact.emergencyPhone],
          ]}
        />
      </section>
    </>
  );
}
function MedicalHistory({
  title,
  items,
}: {
  title: string;
  items: readonly MedicalEntry[];
}) {
  return (
    <section className="record-section">
      <h3>{title}</h3>
      {items.length ? (
        <ul className="clinical-history">
          {items.map((entry) => (
            <li key={entry.date + entry.title}>
              <time dateTime={entry.date}>{calendarDate(entry.date)}</time>
              <div>
                <h4>{entry.title}</h4>
                <p>{entry.details}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>No entries recorded.</p>
      )}
    </section>
  );
}
export function MedicalFields() {
  const medical = useLoaderData<Medical>();
  return (
    <>
      <section className="record-section">
        <h3>Medical record</h3>
        <p className="muted">
          Fictional employee health information for this tutorial.
        </p>
        <Facts
          items={[
            ["Date of birth", calendarDate(medical.dateOfBirth)],
            ["Blood group", medical.bloodGroup],
            ["Allergies", medical.allergies.join(", ")],
          ]}
        />
      </section>
      <MedicalHistory title="Conditions" items={medical.conditions} />
      <MedicalHistory title="Medication history" items={medical.medications} />
      <MedicalHistory title="Consultations" items={medical.consultations} />
      <MedicalHistory title="Test results" items={medical.testResults} />
      <MedicalHistory title="Vaccinations" items={medical.vaccinations} />
      <MedicalHistory
        title="Occupational-health assessments"
        items={medical.assessments}
      />
    </>
  );
}
