import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { Workspace } from "../shared/types.ts";
import { ApiError, api } from "./api.ts";
import cedarlingMark from "./assets/cedarling-mark.png";
import cedarlingWordmark from "./assets/cedarling-wordmark-dark.webp";
import { CommandAttempt, type MutationInput } from "./command-attempt.ts";
import { TransferDetails } from "./TransferDetails.tsx";

type Notice = Readonly<{ kind: "success" | "error"; text: string }> | undefined;
type View = "transfers" | "inventory";

function message(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      version_conflict: "The transfer changed. Refresh and try again.",
      transition_invalid: "This transfer cannot make that transition.",
      insufficient_stock: "The source warehouse does not have enough stock.",
      authorization_denied:
        "This workload is not allowed to perform this action.",
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
        <a
          href="https://cedarling.dev"
          target="_blank"
          rel="noopener noreferrer"
        >
          Cedarling.dev
        </a>
        <a
          href="https://docs.jans.io/stable/cedarling/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Cedarling Docs
        </a>
        <a
          href="https://gluu.org/agama-lab/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Agama Lab
        </a>
        <a
          href="https://docs.jans.io/stable/cedarling/reference/cedarling-lock-server/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Lock Server
        </a>
        <a href="https://gluu.org" target="_blank" rel="noopener noreferrer">
          Gluu
        </a>
      </nav>
    </footer>
  );
}

function Header() {
  return (
    <header className="brand-rail">
      <picture className="brand-lockup">
        <source media="(max-width: 980px)" srcSet={cedarlingMark} />
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

function Inventory({ rows }: Readonly<{ rows: Workspace["inventory"] }>) {
  return (
    <section className="panel-card" aria-labelledby="inventory-title">
      <div className="section-heading">
        <div>
          <h2 id="inventory-title">Current inventory</h2>
          <p>Stock reported by the Inventory Auditor.</p>
        </div>
      </div>
      <section
        className="table-wrap"
        aria-label="Inventory stock levels"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the stock table horizontally.
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th>Warehouse</th>
              <th>Item</th>
              <th>On hand</th>
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
      </section>
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
  const [mobileView, setMobileView] = useState<
    "list" | "create" | "detail" | "inventory"
  >(() =>
    parameters.get("view") === "inventory"
      ? "inventory"
      : parameters.has("transfer")
        ? "detail"
        : "list",
  );
  const railRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const attempt = useRef(new CommandAttempt());
  const [needsRefresh, setNeedsRefresh] = useState(false);
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
      setNeedsRefresh(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load().catch((error: unknown) => {
      setNotice({ kind: "error", text: message(error) });
      setNeedsRefresh(true);
    });
  }, [load]);

  useEffect(() => {
    updateLocation(view, selectedId);
  }, [selectedId, updateLocation, view]);
  useEffect(() => {
    if (
      mobileView !== "list" &&
      window.matchMedia("(max-width: 980px)").matches
    )
      panelRef.current?.focus();
  }, [mobileView]);

  const run = async (
    workloadId: WorkloadId,
    command: MutationInput,
    success: string,
  ) => {
    if (pending.current || needsRefresh) return;
    pending.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await api.command(
        workloadId,
        attempt.current.prepare(workloadId, command),
      );
      attempt.current.acknowledge();
      if (result.transfer) {
        const transfer = result.transfer;
        setSelectedId(transfer.id);
        setWorkspace((current) =>
          current
            ? {
                ...current,
                transfers: [
                  transfer,
                  ...current.transfers.filter(
                    (item) => item.id !== transfer.id,
                  ),
                ],
              }
            : current,
        );
        setMobileView("detail");
      }
      try {
        await load();
        setNotice({ kind: "success", text: success });
      } catch {
        setNeedsRefresh(true);
        setNotice({
          kind: "error",
          text: `${success} Refresh the workspace to load current stock before continuing.`,
        });
      }
    } catch (error) {
      setNotice({ kind: "error", text: message(error) });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const create = (workloadId: WorkloadId) => {
    void run(
      workloadId,
      {
        type: "transfer.create",
        ...draft,
      },
      `${WORKLOADS.find(({ id }) => id === workloadId)?.shortLabel} created the transfer.`,
    );
  };

  if (loading)
    return <main className="loading">Loading warehouse workspace…</main>;

  return (
    <div className="app-shell">
      <Header />
      <main className={`workspace mobile-${mobileView}`}>
        <aside className="transfer-rail" ref={railRef}>
          <nav className="view-tabs" aria-label="Workspace views">
            <button
              type="button"
              disabled={busy}
              className={view === "transfers" ? "active" : ""}
              onClick={() => {
                setView("transfers");
                setMobileView("list");
              }}
            >
              Transfers
            </button>
            <button
              type="button"
              disabled={busy}
              className={view === "inventory" ? "active" : ""}
              onClick={() => {
                setView("inventory");
                setMobileView("inventory");
              }}
            >
              Inventory
            </button>
          </nav>
          {view === "transfers" && (
            <button
              type="button"
              className="secondary new-transfer"
              disabled={busy}
              onClick={() => {
                setMobileView("create");
                requestAnimationFrame(() =>
                  document.getElementById("create-transfer-title")?.focus(),
                );
              }}
            >
              New transfer
            </button>
          )}
          {view === "transfers" ? (
            <nav className="transfer-list" aria-label="Transfers">
              {workspace?.transfers.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`transfer-item ${item.id === selectedId && mobileView !== "create" ? "selected" : ""}`}
                  aria-current={
                    item.id === selectedId && mobileView !== "create"
                      ? "true"
                      : undefined
                  }
                  disabled={busy}
                  onClick={() => {
                    setSelectedId(item.id);
                    setMobileView("detail");
                  }}
                >
                  <strong>{skuLabel(item.skuId)}</strong>
                  <span>
                    {warehouseLabel(item.sourceId)} →{" "}
                    {warehouseLabel(item.destinationId)}
                  </span>
                  <span>
                    {item.quantity} {item.quantity === 1 ? "unit" : "units"} ·{" "}
                    {item.status.replace("_", " ")}
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

        <section
          className="main-panel"
          ref={panelRef}
          tabIndex={-1}
          aria-label="Transfer workspace"
        >
          <button
            type="button"
            className="secondary mobile-back"
            onClick={() => {
              setMobileView("list");
              setView("transfers");
              requestAnimationFrame(() =>
                railRef.current
                  ?.querySelector<HTMLButtonElement>(
                    '[aria-current="true"], .new-transfer',
                  )
                  ?.focus(),
              );
            }}
          >
            Back to transfers
          </button>
          {notice && (
            <p
              className={`notice ${notice.kind}`}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.text}
            </p>
          )}
          {needsRefresh && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await load();
                  setNotice({ kind: "success", text: "Workspace refreshed." });
                } catch (error) {
                  setNotice({ kind: "error", text: message(error) });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Refresh workspace
            </button>
          )}
          {view === "inventory" && workspace ? (
            <Inventory rows={workspace.inventory} />
          ) : (
            <div className="transfer-layout">
              <section
                className="panel-card create-card"
                hidden={mobileView !== "create"}
              >
                <h2 id="create-transfer-title" tabIndex={-1}>
                  Plan stock transfer
                </h2>
                <p>
                  Choose the route, item, and quantity. Stock moves when the
                  source warehouse releases the transfer.
                </p>
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
                    <button
                      className="primary"
                      disabled={busy || needsRefresh}
                      type="submit"
                    >
                      Create as Planner
                    </button>
                  </div>
                  <details className="baseline-comparison">
                    <summary>Try another workload</summary>
                    <p>
                      The Auditor is intended to read inventory. The baseline
                      also lets it create a transfer.
                    </p>
                    <button
                      className="secondary"
                      disabled={busy || needsRefresh}
                      type="button"
                      onClick={() => create("inventory-auditor")}
                    >
                      Try as Auditor
                    </button>
                  </details>
                </form>
              </section>

              <section
                className="panel-card detail-card"
                hidden={mobileView === "create"}
              >
                {selected ? (
                  <TransferDetails
                    transfer={selected}
                    inventory={workspace?.inventory ?? []}
                    busy={busy || needsRefresh}
                    onRun={run}
                  />
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
