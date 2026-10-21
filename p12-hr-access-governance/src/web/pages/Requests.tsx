import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRouteLoaderData,
  useSearchParams,
} from "react-router";
import {
  type AccessOptions,
  accessPackages,
  type Grant,
  type Profile,
  type SessionView,
} from "../../shared/contracts.ts";
import {
  BackLink,
  date,
  Facts,
  Notice,
  PageHeading,
  Status,
} from "../components/Feedback.tsx";
import { Avatar } from "../components/Shell.tsx";
import { useDeadlineRefresh } from "../hooks/use-deadline-refresh.ts";

export function Requests() {
  const grants = useLoaderData<Grant[]>();
  const deadlines = grants.flatMap((grant) =>
    grant.status === "pending"
      ? [grant.reviewDeadline]
      : grant.status === "approved" && grant.expiresAt
        ? [grant.expiresAt]
        : [],
  );
  useDeadlineRefresh(deadlines.length ? Math.min(...deadlines) : null);
  const session = useRouteLoaderData<SessionView>("root");
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const q = params.get("q") ?? "";
  const filtered = grants.filter(
    (grant) =>
      (params.get("view") !== "requests" ||
        grant.requesterId === session?.user.id) &&
      (!status || grant.status === status) &&
      [grant.employeeName, grant.beneficiaryName, grant.requesterName].some(
        (value) => value.toLowerCase().includes(q.toLowerCase()),
      ),
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
        title="Access requests"
        description="Review who needs access, which records they need, and for how long."
      >
        <Link className="primary" to="/access-requests/new">
          New request
        </Link>
      </PageHeading>
      <nav className="queue-views" aria-label="Request view">
        <Link
          aria-current={params.get("view") !== "requests" ? "page" : undefined}
          to="/access-requests?view=review"
        >
          Review queue
        </Link>
        <Link
          aria-current={params.get("view") === "requests" ? "page" : undefined}
          to="/access-requests?view=requests"
        >
          My requests
        </Link>
      </nav>
      <div className="filters">
        <label className="search">
          Find a request
          <input
            type="search"
            placeholder="Employee, beneficiary or requester"
            value={q}
            onChange={(event) => filter("q", event.target.value)}
          />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => filter("status", event.target.value)}
          >
            <option value="">All statuses</option>
            {["pending", "approved", "rejected", "revoked", "expired"].map(
              (value) => (
                <option key={value} value={value}>
                  {value === "rejected"
                    ? "Declined"
                    : value[0]?.toUpperCase() + value.slice(1)}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      <p className="result-count" role="status">
        {filtered.length} {filtered.length === 1 ? "request" : "requests"}
      </p>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Access requests</caption>
          <thead>
            <tr>
              <th>Employee and access</th>
              <th className="hide-narrow">Beneficiary</th>
              <th className="hide-medium">Requested by</th>
              <th>Status</th>
              <th className="hide-narrow">Next deadline</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((grant) => (
              <tr key={grant.id}>
                <td>
                  <Link
                    className="person-link"
                    to={
                      "/access-requests/" +
                      grant.id +
                      "?view=" +
                      (params.get("view") === "requests"
                        ? "requests"
                        : "review")
                    }
                  >
                    <Avatar name={grant.employeeName} />
                    <span>
                      <strong>{grant.employeeName}</strong>
                      <small>{grant.packageName}</small>
                    </span>
                  </Link>
                </td>
                <td className="hide-narrow">{grant.beneficiaryName}</td>
                <td className="hide-medium">{grant.requesterName}</td>
                <td>
                  <Status value={grant.status} />
                </td>
                <td className="hide-narrow">
                  {grant.status === "pending"
                    ? date(grant.reviewDeadline)
                    : grant.status === "approved"
                      ? date(grant.expiresAt)
                      : "Complete"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <h3>
            {grants.length
              ? "No requests match these filters"
              : "No access requests yet"}
          </h3>
          <p>
            {grants.length
              ? "Change the search or status filter."
              : "Choose an employee and request contact or medical access."}
          </p>
          <Link to="/access-requests/new">Request access</Link>
        </div>
      )}
    </section>
  );
}
export type NewRequestData = { employees: Profile[]; options: AccessOptions };
export function NewRequest() {
  const { employees, options } = useLoaderData<NewRequestData>();
  const [params] = useSearchParams();
  const [employeeId, setEmployeeId] = useState(
    params.get("employee") ?? employees[0]?.id ?? "",
  );
  const [packageId, setPackageId] = useState(
    params.get("package") === "occupational-health"
      ? "occupational-health"
      : "team-support",
  );
  const person = employees.find((employee) => employee.id === employeeId);
  const error = useActionData<{ message: string }>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return (
    <section className="page request-page">
      <BackLink to={person ? `/employees/${person.id}` : "/access-requests"}>
        Back to {person ? "employee" : "access requests"}
      </BackLink>
      <PageHeading
        title="Request temporary access"
        description="A reviewer has 24 hours to decide. Approved access starts when they approve the request."
      />
      <Form method="post" className="request-form">
        <label>
          Employee
          <select
            name="employeeId"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            required
          >
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name} · {employee.employeeNumber}
              </option>
            ))}
          </select>
        </label>
        <label>
          Access package
          <select
            name="packageId"
            value={packageId}
            onChange={(event) => setPackageId(event.target.value)}
          >
            {options.packages.map((pkg) => (
              <option key={pkg.id} value={pkg.id}>
                {pkg.name}
              </option>
            ))}
          </select>
        </label>
        {packageId === "team-support" ? (
          <div className="form-context">
            <strong>
              Access for {person?.managerName ?? "the current manager"}
            </strong>
            <p>
              Contact details and the emergency contact for this employee.
              Profile details are read separately.
            </p>
          </div>
        ) : (
          <label>
            Access for
            <select
              name="beneficiaryId"
              defaultValue={
                options.beneficiaries.find(
                  (value) => value.role === "Occupational-health clinician",
                )?.id ?? ""
              }
              required
            >
              {options.beneficiaries.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name} · {value.role}
                </option>
              ))}
            </select>
            <small>
              Medical records have their own grant, separate from contact
              details.
            </small>
          </label>
        )}
        <label>
          Access duration
          <select name="days" defaultValue="1">
            {[1, 2, 3, 4, 5, 6, 7].map((days) => (
              <option key={days} value={days}>
                {days} {days === 1 ? "day" : "days"} after approval
              </option>
            ))}
          </select>
        </label>
        <label>
          Why is access needed?
          <textarea
            name="reason"
            minLength={10}
            maxLength={500}
            rows={3}
            required
            placeholder="Describe the work that requires this access."
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error.message}
          </p>
        )}
        <div className="form-actions">
          <Link className="secondary" to="/access-requests">
            Cancel
          </Link>
          <button className="primary" type="submit" disabled={busy || !person}>
            {busy ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </Form>
    </section>
  );
}
function ConfirmReview({
  grant,
  operation,
  close,
}: {
  grant: Grant;
  operation: "reject" | "revoke";
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fetcher = useFetcher<{ message?: string }>();
  const busy = fetcher.state !== "idle";
  const opened = useRef(false);
  useEffect(() => {
    const trigger = document.activeElement;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLElement>("textarea,button")?.focus();
    return () => {
      dialog.current?.close();
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, []);
  useEffect(() => {
    if (fetcher.state !== "idle") opened.current = true;
    else if (opened.current && !fetcher.data?.message) close();
  }, [fetcher.state, fetcher.data, close]);
  function cancel(event: FormEvent) {
    event.preventDefault();
    if (!busy) close();
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="review-dialog-title"
      onCancel={cancel}
    >
      <fetcher.Form method="post" action={`/access-requests/${grant.id}`}>
        <h2 id="review-dialog-title">
          {operation === "reject"
            ? "Decline this request?"
            : "Revoke this access?"}
        </h2>
        <p>
          {grant.packageName} for {grant.beneficiaryName}, covering{" "}
          {grant.employeeName}.
        </p>
        <input type="hidden" name="operation" value={operation} />
        <input type="hidden" name="version" value={grant.version} />
        {operation === "reject" ? (
          <label>
            Reason
            <textarea
              name="note"
              minLength={3}
              maxLength={500}
              rows={3}
              required
            />
          </label>
        ) : (
          <p>
            The grant will end immediately. Data already viewed cannot be
            recalled.
          </p>
        )}
        {fetcher.data?.message && (
          <p className="form-error" role="alert">
            {fetcher.data.message}
          </p>
        )}
        <div className="form-actions">
          <button
            className="secondary"
            type="button"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="danger" type="submit" disabled={busy}>
            {busy
              ? "Updating…"
              : operation === "reject"
                ? "Decline request"
                : "Revoke access"}
          </button>
        </div>
      </fetcher.Form>
    </dialog>
  );
}
export function RequestDetails() {
  const grant = useLoaderData<Grant>();
  useDeadlineRefresh(
    grant.status === "pending"
      ? grant.reviewDeadline
      : grant.status === "approved"
        ? grant.expiresAt
        : null,
  );
  const [params] = useSearchParams();
  const error = useActionData<{ message: string }>();
  const [confirmation, setConfirmation] = useState<"reject" | "revoke" | null>(
    null,
  );
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const result = params.get("result");
  return (
    <article className="page record-page">
      <BackLink
        to={
          "/access-requests?view=" +
          (params.get("view") === "requests" ? "requests" : "review")
        }
      >
        Back to access requests
      </BackLink>
      <PageHeading
        title={grant.packageName}
        description={`Requested for ${grant.beneficiaryName}`}
      >
        <Status value={grant.status} />
      </PageHeading>
      {result && (
        <Notice
          key={result + grant.version}
          message={
            result === "created"
              ? "Request submitted for review."
              : result === "existing"
                ? "Opened the existing request."
                : result === "approved"
                  ? "Access approved."
                  : result === "rejected"
                    ? "Request declined."
                    : "Access revoked."
          }
        />
      )}
      <section className="record-section">
        <h3>Requested access</h3>
        <Facts
          items={[
            [
              "Employee",
              <Link key="employee" to={`/employees/${grant.employeeId}`}>
                {grant.employeeName}
              </Link>,
            ],
            ["Access for", grant.beneficiaryName],
            ["Requested by", grant.requesterName],
            [
              "Duration",
              grant.durationDays +
                " " +
                (grant.durationDays === 1 ? "day" : "days") +
                " after approval",
            ],
            ["Submitted", date(grant.createdAt)],
            ["Review deadline", date(grant.reviewDeadline)],
          ]}
        />
        <div className="request-reason">
          <h4>Reason for access</h4>
          <p>{grant.reason}</p>
        </div>
      </section>
      <section className="record-section">
        <h3>Review and access period</h3>
        <Facts
          items={[
            ["Reviewed by", grant.reviewerName ?? "Awaiting review"],
            [
              "Review date",
              grant.reviewedAt ? date(grant.reviewedAt) : "Awaiting review",
            ],
            ["Access begins", date(grant.approvedAt)],
            ["Access ends", date(grant.expiresAt)],
            ...(grant.revokedAt
              ? ([
                  ["Revoked by", grant.revokerName],
                  ["Revoked", date(grant.revokedAt)],
                ] as [string, React.ReactNode][])
              : []),
          ]}
        />
        {grant.reviewNote && (
          <div className="request-reason">
            <h4>Review note</h4>
            <p>{grant.reviewNote}</p>
          </div>
        )}
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      )}
      <div className="record-actions">
        {grant.status === "pending" && (
          <>
            <Form method="post">
              <input type="hidden" name="operation" value="approve" />
              <input type="hidden" name="version" value={grant.version} />
              <button className="primary" type="submit" disabled={busy}>
                {busy ? "Updating…" : "Approve access"}
              </button>
            </Form>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => setConfirmation("reject")}
            >
              Decline request
            </button>
          </>
        )}
        {grant.status === "approved" && (
          <button
            className="danger"
            type="button"
            onClick={() => setConfirmation("revoke")}
          >
            Revoke access
          </button>
        )}
        {["revoked", "expired", "rejected"].includes(grant.status) && (
          <Link
            className="primary"
            to={
              "/access-requests/new?employee=" +
              grant.employeeId +
              "&package=" +
              grant.packageId
            }
          >
            Request access again
          </Link>
        )}
        <Link
          className="secondary"
          to={
            "/employees/" +
            grant.employeeId +
            "/" +
            (accessPackages.find((pkg) => pkg.id === grant.packageId)
              ?.fieldGroup ?? "contact")
          }
        >
          Open employee record
        </Link>
      </div>
      {confirmation && (
        <ConfirmReview
          key={grant.id + confirmation}
          grant={grant}
          operation={confirmation}
          close={() => setConfirmation(null)}
        />
      )}
    </article>
  );
}
