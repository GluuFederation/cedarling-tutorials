import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SKUS,
  type SkuId,
  skuLabel,
  WAREHOUSES,
  type WarehouseId,
  WORKLOADS,
  type WorkloadId,
  warehouseLabel,
} from "../shared/catalog.ts";
import type { Transfer, WorkloadCommand, Workspace } from "../shared/types.ts";
import { ApiError, api } from "./api.ts";
import cedarlingMark from "./assets/cedarling-mark.png";
import cedarlingWordmark from "./assets/cedarling-wordmark-dark.webp";

type Notice = Readonly<{ kind: "success" | "error"; text: string }> | undefined;
type View = "transfers" | "inventory";

function message(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      version_conflict: "The transfer changed. Refresh and try again.",
      transition_invalid: "This transfer cannot make that transition.",
      insufficient_stock: "The source warehouse does not have enough stock.",
      authorization_denied: "Cedarling denied this workload action.",
      origin_invalid: "Reload the application before trying again.",
      dependency_unavailable: "A workload service is unavailable.",
      service_unavailable: "The application is unavailable.",
    };
    return messages[error.code] ?? "The request could not be completed.";
  }
  return "The request could not be completed.";
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

function Header() {
  return (
    <header className="brand-rail">
      <picture className="brand-lockup">
        <source media="(max-width: 760px)" srcSet={cedarlingMark} />
        <img src={cedarlingWordmark} alt="Cedarling" />
      </picture>
      <div className="topbar-copy">
        <h1>P10 - Authorizing Warehouse Workloads with Cedarling</h1>
        <p>
          Authorize machine identities at the stock-transfer effect boundary.
        </p>
      </div>
      <div className="workload-indicator">
        <span aria-hidden="true">M2M</span>
        <strong>Workload console</strong>
      </div>
    </header>
  );
}

function Status({ status }: Readonly<{ status: Transfer["status"] }>) {
  return <span className={`status ${status}`}>{status.replace("_", " ")}</span>;
}

function Inventory({ rows }: Readonly<{ rows: Workspace["inventory"] }>) {
  return (
    <section className="panel-card" aria-labelledby="inventory-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Auditor view</span>
          <h2 id="inventory-title">Current inventory</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Warehouse</th>
              <th>Item</th>
              <th>Available</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.warehouseId}:${row.skuId}`}>
                <td>{warehouseLabel(row.warehouseId)}</td>
                <td>{skuLabel(row.skuId)}</td>
                <td>{row.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function App() {
  const parameters = useMemo(() => new URLSearchParams(location.search), []);
  const [view, setView] = useState<View>(
    parameters.get("view") === "inventory" ? "inventory" : "transfers",
  );
  const [selectedId, setSelectedId] = useState(
    parameters.get("transfer") ?? "",
  );
  const [workspace, setWorkspace] = useState<Workspace>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [draft, setDraft] = useState<{
    sourceId: WarehouseId;
    destinationId: WarehouseId;
    skuId: SkuId;
    quantity: number;
  }>({
    sourceId: "north",
    destinationId: "south",
    skuId: "bearing-kit",
    quantity: 8,
  });

  const selected = workspace?.transfers.find((item) => item.id === selectedId);

  const updateLocation = useCallback(
    (nextView: View, transferId = selectedId) => {
      const next = new URLSearchParams();
      next.set("view", nextView);
      if (transferId) next.set("transfer", transferId);
      history.replaceState(null, "", `?${next.toString()}`);
    },
    [selectedId],
  );

  const load = useCallback(async () => {
    try {
      const next = await api.workspace();
      setWorkspace(next);
      setSelectedId((current) =>
        current && next.transfers.some((item) => item.id === current)
          ? current
          : (next.transfers[0]?.id ?? ""),
      );
    } catch (error) {
      setNotice({ kind: "error", text: message(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    updateLocation(view, selectedId);
  }, [selectedId, updateLocation, view]);

  const run = async (
    workloadId: WorkloadId,
    command: WorkloadCommand,
    success: string,
  ) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await api.command(workloadId, command);
      if (result.transfer) setSelectedId(result.transfer.id);
      await load();
      setNotice({ kind: "success", text: success });
    } catch (error) {
      setNotice({ kind: "error", text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const create = (workloadId: WorkloadId) => {
    void run(
      workloadId,
      {
        type: "transfer.create",
        ...draft,
        idempotencyKey: crypto.randomUUID(),
      },
      `${WORKLOADS.find(({ id }) => id === workloadId)?.shortLabel} created the transfer.`,
    );
  };

  if (loading) return <main className="loading">Loading CedarStock…</main>;

  return (
    <div className="app-shell">
      <Header />
      <main className="workspace">
        <aside className="transfer-rail">
          <nav className="view-tabs" aria-label="Workspace views">
            <button
              type="button"
              className={view === "transfers" ? "active" : ""}
              onClick={() => setView("transfers")}
            >
              Transfers
            </button>
            <button
              type="button"
              className={view === "inventory" ? "active" : ""}
              onClick={() => setView("inventory")}
            >
              Inventory
            </button>
          </nav>
          {view === "transfers" ? (
            <nav className="transfer-list" aria-label="Transfers">
              {workspace?.transfers.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`transfer-item ${item.id === selectedId ? "selected" : ""}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <strong>{skuLabel(item.skuId)}</strong>
                  <span>
                    {warehouseLabel(item.sourceId)} →{" "}
                    {warehouseLabel(item.destinationId)}
                  </span>
                  <span>
                    {item.quantity} units · v{item.version}
                  </span>
                </button>
              ))}
            </nav>
          ) : (
            <div className="workload-list">
              {WORKLOADS.map((workload) => (
                <article key={workload.id}>
                  <strong>{workload.label}</strong>
                  <span>{workload.purpose}</span>
                </article>
              ))}
            </div>
          )}
        </aside>

        <section className="main-panel">
          {notice && (
            <p className={`notice ${notice.kind}`} role="status">
              {notice.text}
            </p>
          )}
          {view === "inventory" && workspace ? (
            <Inventory rows={workspace.inventory} />
          ) : (
            <div className="transfer-layout">
              <section className="panel-card create-card">
                <span className="eyebrow">Transfer Planner</span>
                <h2>Plan stock transfer</h2>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    create("transfer-planner");
                  }}
                >
                  <div className="form-grid">
                    <label>
                      From
                      <select
                        value={draft.sourceId}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            sourceId: event.target.value as WarehouseId,
                          }))
                        }
                      >
                        {WAREHOUSES.map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>
                            {warehouse.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      To
                      <select
                        value={draft.destinationId}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            destinationId: event.target.value as WarehouseId,
                          }))
                        }
                      >
                        {WAREHOUSES.map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>
                            {warehouse.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Item
                      <select
                        value={draft.skuId}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            skuId: event.target.value as SkuId,
                          }))
                        }
                      >
                        {SKUS.map((sku) => (
                          <option key={sku.id} value={sku.id}>
                            {sku.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Quantity
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        value={draft.quantity}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            quantity: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="actions">
                    <button className="primary" disabled={busy} type="submit">
                      Create as Planner
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      type="button"
                      onClick={() => create("inventory-auditor")}
                    >
                      Try as Auditor
                    </button>
                  </div>
                </form>
              </section>

              <section className="panel-card detail-card">
                {selected ? (
                  <>
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">Selected transfer</span>
                        <h2>{skuLabel(selected.skuId)}</h2>
                      </div>
                      <Status status={selected.status} />
                    </div>
                    <dl className="facts">
                      <div>
                        <dt>Route</dt>
                        <dd>
                          {warehouseLabel(selected.sourceId)} →{" "}
                          {warehouseLabel(selected.destinationId)}
                        </dd>
                      </div>
                      <div>
                        <dt>Quantity</dt>
                        <dd>{selected.quantity} units</dd>
                      </div>
                      <div>
                        <dt>Version</dt>
                        <dd>{selected.version}</dd>
                      </div>
                    </dl>
                    {selected.status === "planned" && (
                      <div className="actions split-actions">
                        <button
                          className="primary"
                          disabled={busy}
                          type="button"
                          onClick={() =>
                            void run(
                              "warehouse-north",
                              {
                                type: "transfer.release",
                                transferId: selected.id,
                                expectedVersion: selected.version,
                                idempotencyKey: crypto.randomUUID(),
                              },
                              "North released the transfer.",
                            )
                          }
                        >
                          Release as North
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          type="button"
                          onClick={() =>
                            void run(
                              "warehouse-south",
                              {
                                type: "transfer.release",
                                transferId: selected.id,
                                expectedVersion: selected.version,
                                idempotencyKey: crypto.randomUUID(),
                              },
                              "South released the transfer.",
                            )
                          }
                        >
                          Release as South
                        </button>
                      </div>
                    )}
                    {selected.status === "in_transit" && (
                      <div className="actions split-actions">
                        <button
                          className="primary"
                          disabled={busy}
                          type="button"
                          onClick={() =>
                            void run(
                              "warehouse-south",
                              {
                                type: "transfer.receive",
                                transferId: selected.id,
                                expectedVersion: selected.version,
                                idempotencyKey: crypto.randomUUID(),
                              },
                              "South received the transfer.",
                            )
                          }
                        >
                          Receive as South
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          type="button"
                          onClick={() =>
                            void run(
                              "warehouse-north",
                              {
                                type: "transfer.receive",
                                transferId: selected.id,
                                expectedVersion: selected.version,
                                idempotencyKey: crypto.randomUUID(),
                              },
                              "North received the transfer.",
                            )
                          }
                        >
                          Receive as North
                        </button>
                      </div>
                    )}
                    {selected.status === "received" && (
                      <p className="complete-note">
                        Stock movement is complete.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="empty-state">
                    <h2>Select a transfer</h2>
                  </div>
                )}
              </section>
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
