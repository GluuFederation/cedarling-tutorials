import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DatasetField,
  ExportCreated,
  FieldName,
  QueryPlan,
  QueryResponse,
  SessionResponse,
} from "../shared/contracts";
import { ApiError, api } from "./api";
import cedarlingMark from "./assets/cedarling-mark.png";
import cedarlingWordmark from "./assets/cedarling-wordmark-dark.webp";
import { Icon } from "./Icon";

const accounts = [
  {
    id: "amina",
    initials: "AM",
    name: "Amina",
    context: "Support analyst · Tenant A",
  },
  {
    id: "leah",
    initials: "LF",
    name: "Leah",
    context: "Finance lead · Tenant A",
  },
  {
    id: "theo",
    initials: "TR",
    name: "Theo",
    context: "External reviewer · Tenant B",
  },
] as const;

type LoadState = "loading" | "ready" | "error";
type Notice = { kind: "success" | "error"; text: string } | null;

function friendlyError(error: unknown): string {
  if (!(error instanceof ApiError))
    return "The application could not complete the request.";
  const messages: Record<string, string> = {
    authentication_required: "Your session expired. Choose an identity again.",
    database_unavailable: "The dataset is temporarily unavailable.",
    export_expired: "This export has expired.",
    export_revoked: "This export was revoked.",
    export_unavailable: "The export could not be created.",
    invalid_query_plan: "Review the query fields and filter.",
    request_verification_failed: "The request could not be verified.",
  };
  return (
    messages[error.code] ?? "The application could not complete the request."
  );
}

function BrandRail({
  session,
  onSwitch,
}: Readonly<{ session?: SessionResponse; onSwitch?: () => void }>) {
  return (
    <header className="brand-rail">
      <picture className="brand-lockup">
        <source media="(max-width: 760px)" srcSet={cedarlingMark} />
        <img src={cedarlingWordmark} alt="Cedarling" />
      </picture>
      <div className="topbar-copy">
        <h1>
          P5 - Protecting Sensitive Fields and Data Exports with Cedarling
        </h1>
        <p>Authorize every field, row, aggregate, and export.</p>
      </div>
      {session ? (
        <details className="account-menu">
          <summary className="rail-identity" aria-label="Open account menu">
            <span className="identity-avatar" aria-hidden="true">
              {session.user.name
                .split(" ")
                .map((part) => part[0])
                .join("")}
            </span>
            <span className="identity-copy">
              <strong>{session.user.name}</strong>
              <small>{session.user.role}</small>
            </span>
          </summary>
          <div className="account-menu-items">
            <button type="button" onClick={onSwitch}>
              Change account
            </button>
            <button type="button" onClick={onSwitch}>
              Sign out
            </button>
          </div>
        </details>
      ) : (
        <span aria-hidden="true" />
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer>
      <nav aria-label="Related resources">
        <a href="https://cedarling.dev">Cedarling.dev</a>
        <a href="https://docs.jans.io/stable/cedarling/">Cedarling Docs</a>
        <a href="https://gluu.org/agama-lab/">Agama Lab</a>
        <a href="https://docs.jans.io/stable/cedarling/reference/cedarling-lock-server/">
          Lock Server
        </a>
        <a href="https://gluu.org">Gluu</a>
      </nav>
    </footer>
  );
}

function Login({ expired = false }: Readonly<{ expired?: boolean }>) {
  return (
    <div className="app-shell">
      <BrandRail />
      <main className="landing">
        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-heading">
            <h2 id="login-title">Choose a tutorial identity</h2>
            <p>Explore one analytics workflow from three roles.</p>
          </div>
          {expired && (
            <p className="inline-feedback" role="alert">
              Session expired. Choose an identity again.
            </p>
          )}
          <nav className="account-choices" aria-label="Tutorial identities">
            {accounts.map((account) => (
              <a
                className="account-choice"
                href={`/auth/login?login_hint=${account.id}`}
                key={account.id}
              >
                <span className="account-avatar" aria-hidden="true">
                  {account.initials}
                </span>
                <span className="account-copy">
                  <strong>{account.name}</strong>
                  <small>{account.context}</small>
                </span>
                <Icon name="arrow-right" size={20} />
              </a>
            ))}
          </nav>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function ServiceFailure({ retry }: Readonly<{ retry: () => void }>) {
  return (
    <div className="app-shell">
      <BrandRail />
      <main className="landing">
        <section className="service-state" aria-labelledby="service-title">
          <Icon name="warning" size={28} />
          <h2 id="service-title">Application unavailable</h2>
          <p>The session service could not be reached.</p>
          <button className="primary" onClick={retry} type="button">
            Retry
          </button>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function resultSummary(count: number, kind: QueryPlan["kind"]): string {
  const unit = kind === "aggregate" ? "group" : "row";
  return `${String(count)} ${unit}${count === 1 ? "" : "s"} returned`;
}

function Workspace({
  session,
  onExpired,
}: Readonly<{ session: SessionResponse; onExpired: () => void }>) {
  const [fields, setFields] = useState<DatasetField[]>([]);
  const [mode, setMode] = useState<"rows" | "aggregate">("rows");
  const [selected, setSelected] = useState<FieldName[]>([
    "employeeId",
    "department",
    "location",
    "supportTier",
    "employmentStatus",
    "tenantId",
  ]);
  const [purpose, setPurpose] = useState<QueryPlan["purpose"]>("support");
  const [limit, setLimit] = useState(10);
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [filterField, setFilterField] = useState<FieldName>("tenantId");
  const [filterOperator, setFilterOperator] = useState<
    "eq" | "contains" | "gte" | "lte"
  >("eq");
  const [filterValue, setFilterValue] = useState("tenant-a");
  const [aggregateOperation, setAggregateOperation] = useState<
    "count" | "average"
  >("count");
  const [aggregateField, setAggregateField] = useState<"salary" | "bonus">(
    "salary",
  );
  const [groupBy, setGroupBy] = useState<FieldName | "">("department");
  const [result, setResult] = useState<QueryResponse>();
  const [lastPlan, setLastPlan] = useState<QueryPlan>();
  const [activeExport, setActiveExport] = useState<ExportCreated>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    void api
      .dataset()
      .then((response) => setFields(response.dataset.fields))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) onExpired();
        else setNotice({ kind: "error", text: friendlyError(error) });
      });
  }, [onExpired]);

  const filterMetadata = fields.find((field) => field.name === filterField);
  const plan = useMemo<QueryPlan>(() => {
    const numeric = filterMetadata?.type === "number";
    const filter = filterEnabled
      ? {
          field: filterField,
          operator: filterOperator,
          value: numeric ? Number(filterValue) : filterValue,
        }
      : undefined;
    return mode === "rows"
      ? { kind: "rows", fields: selected, filter, purpose, limit }
      : {
          kind: "aggregate",
          operation: aggregateOperation,
          ...(aggregateOperation === "average"
            ? { field: aggregateField }
            : {}),
          ...(groupBy ? { groupBy } : {}),
          filter,
          purpose,
          limit,
        };
  }, [
    aggregateField,
    aggregateOperation,
    filterEnabled,
    filterField,
    filterMetadata?.type,
    filterOperator,
    filterValue,
    groupBy,
    limit,
    mode,
    purpose,
    selected,
  ]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onExpired();
        return;
      }
      setNotice({ kind: "error", text: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function runQuery() {
    await perform(async () => {
      const response = await api.query(plan, session.csrfToken);
      setResult(response);
      setLastPlan(plan);
      setActiveExport(undefined);
      setNotice({
        kind: "success",
        text: `${resultSummary(response.rows.length, plan.kind)}.`,
      });
    });
  }

  async function createExport() {
    if (!lastPlan) return;
    await perform(async () => {
      const response = await api.createExport(lastPlan, session.csrfToken);
      setActiveExport(response);
      setNotice({
        kind: "success",
        text: "Export ready.",
      });
    });
  }

  async function switchAccount() {
    await perform(async () => {
      await api.logout(session.csrfToken);
      location.assign("/");
    });
  }

  const filterOperators =
    filterMetadata?.type === "number"
      ? (["eq", "gte", "lte"] as const)
      : (["eq", "contains"] as const);

  return (
    <div className="app-shell">
      <BrandRail session={session} onSwitch={() => void switchAccount()} />
      <main className="workspace">
        <section className="query-panel" aria-labelledby="query-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Workforce dataset</span>
              <h2 id="query-title">Query plan</h2>
            </div>
            <span className="record-count">18 records</span>
          </div>

          <fieldset className="segmented">
            <legend>Result type</legend>
            <label>
              <input
                checked={mode === "rows"}
                name="mode"
                onChange={() => setMode("rows")}
                type="radio"
              />
              Rows
            </label>
            <label>
              <input
                checked={mode === "aggregate"}
                name="mode"
                onChange={() => setMode("aggregate")}
                type="radio"
              />
              Aggregate
            </label>
          </fieldset>

          {mode === "rows" ? (
            <fieldset className="field-selector">
              <legend>Fields</legend>
              <div className="field-options">
                {fields.map((field) => (
                  <label key={field.name}>
                    <input
                      checked={selected.includes(field.name)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, field.name]
                            : current.filter((name) => name !== field.name),
                        )
                      }
                      type="checkbox"
                    />
                    <span>{field.label}</span>
                    <small>{field.classification}</small>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <div className="control-grid">
              <label>
                Aggregate
                <select
                  value={aggregateOperation}
                  onChange={(event) =>
                    setAggregateOperation(
                      event.target.value as "count" | "average",
                    )
                  }
                >
                  <option value="count">Count</option>
                  <option value="average">Average</option>
                </select>
              </label>
              {aggregateOperation === "average" && (
                <label>
                  Numeric field
                  <select
                    value={aggregateField}
                    onChange={(event) =>
                      setAggregateField(
                        event.target.value as "salary" | "bonus",
                      )
                    }
                  >
                    <option value="salary">Salary</option>
                    <option value="bonus">Bonus</option>
                  </select>
                </label>
              )}
              <label>
                Group by
                <select
                  value={groupBy}
                  onChange={(event) =>
                    setGroupBy(event.target.value as FieldName | "")
                  }
                >
                  <option value="">No grouping</option>
                  {fields.map((field) => (
                    <option key={field.name} value={field.name}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <fieldset className="filter-controls">
            <legend>
              <label className="filter-toggle">
                <input
                  checked={filterEnabled}
                  onChange={(event) => setFilterEnabled(event.target.checked)}
                  type="checkbox"
                />
                Filter
              </label>
            </legend>
            {filterEnabled && (
              <div className="control-grid filter-grid">
                <label>
                  Field
                  <select
                    value={filterField}
                    onChange={(event) => {
                      const next = event.target.value as FieldName;
                      const metadata = fields.find(
                        (field) => field.name === next,
                      );
                      setFilterField(next);
                      setFilterOperator("eq");
                      setFilterValue(metadata?.type === "number" ? "0" : "");
                    }}
                  >
                    {fields.map((field) => (
                      <option key={field.name} value={field.name}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Operator
                  <select
                    value={filterOperator}
                    onChange={(event) =>
                      setFilterOperator(
                        event.target.value as typeof filterOperator,
                      )
                    }
                  >
                    {filterOperators.map((operator) => (
                      <option key={operator} value={operator}>
                        {operator}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Value
                  <input
                    min={filterMetadata?.type === "number" ? 0 : undefined}
                    onChange={(event) => setFilterValue(event.target.value)}
                    required
                    type={filterMetadata?.type === "number" ? "number" : "text"}
                    value={filterValue}
                  />
                </label>
              </div>
            )}
          </fieldset>

          <div className="control-grid final-controls">
            <label>
              Purpose
              <select
                value={purpose}
                onChange={(event) =>
                  setPurpose(event.target.value as typeof purpose)
                }
              >
                <option value="support">Support</option>
                <option value="finance-review">Finance review</option>
                <option value="external-audit">External audit</option>
              </select>
            </label>
            <label>
              Limit
              <input
                max={50}
                min={1}
                onChange={(event) => setLimit(Number(event.target.value))}
                type="number"
                value={limit}
              />
            </label>
          </div>

          <button
            className="primary run-button"
            disabled={
              busy ||
              (mode === "rows" && selected.length === 0) ||
              (filterEnabled && filterValue.length === 0)
            }
            onClick={() => void runQuery()}
            type="button"
          >
            <Icon name="play" size={18} />
            Run query
          </button>
        </section>

        <section className="results-panel" aria-labelledby="results-title">
          <div className="section-heading results-heading">
            <div>
              <span className="eyebrow">Current projection</span>
              <h2 id="results-title">Results</h2>
            </div>
            {result && (
              <span className="record-count">
                {resultSummary(result.rows.length, lastPlan?.kind ?? mode)}
              </span>
            )}
          </div>

          <section aria-label="Query results" className="table-region">
            {!result ? (
              <div className="empty-state">
                <Icon name="shield-check" size={32} />
                <p>Run a bounded query to inspect its projection.</p>
              </div>
            ) : result.rows.length === 0 ? (
              <div className="empty-state">
                <p>No records match this plan.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    {result.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr key={String(row.employeeId ?? `row-${String(index)}`)}>
                      {result.columns.map((column) => (
                        <td key={column}>{String(row[column] ?? "—")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <aside className="export-bar" aria-labelledby="export-title">
            <div className="export-copy">
              <Icon name="file" size={24} />
              <div>
                <h3 id="export-title">CSV export</h3>
                <p>
                  {activeExport
                    ? `Status: ${activeExport.export.state}`
                    : "Create an export from the current result."}
                </p>
              </div>
            </div>
            <div className="export-actions">
              <button
                className="secondary"
                disabled={busy || !lastPlan}
                onClick={() => void createExport()}
                type="button"
              >
                Create export
              </button>
              {activeExport?.export.state === "ready" && (
                <>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await api.download(
                          activeExport.downloadRef,
                          session.csrfToken,
                        );
                        setNotice({
                          kind: "success",
                          text: "Export downloaded.",
                        });
                      })
                    }
                    type="button"
                  >
                    <Icon name="download" size={18} />
                    Download
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const response = await api.revokeExport(
                          activeExport.export.id,
                          session.csrfToken,
                        );
                        setActiveExport({
                          ...activeExport,
                          export: response.export,
                        });
                        setNotice({ kind: "success", text: "Export revoked." });
                      })
                    }
                    type="button"
                  >
                    Revoke
                  </button>
                </>
              )}
            </div>
          </aside>
          {notice && (
            <p
              className={
                notice.kind === "error" ? "toast toast--error" : "toast"
              }
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.text}
            </p>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}

export function App() {
  const [state, setState] = useState<LoadState>("loading");
  const [session, setSession] = useState<SessionResponse>();
  const [expired, setExpired] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const value = await api.session();
      setSession(value);
      setState("ready");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession(undefined);
        setState("ready");
      } else {
        setState("error");
      }
    }
  }, []);

  useEffect(() => void load(), [load]);

  if (state === "loading") return <div className="loading-screen" />;
  if (state === "error") return <ServiceFailure retry={() => void load()} />;
  if (!session) return <Login expired={expired} />;
  return (
    <Workspace
      session={session}
      onExpired={() => {
        setExpired(true);
        setSession(undefined);
      }}
    />
  );
}
