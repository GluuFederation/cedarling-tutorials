import {
  skuLabel,
  type WorkloadId,
  warehouseLabel,
} from "../shared/catalog.ts";
import type { Transfer, Workspace } from "../shared/types.ts";
import type { MutationInput } from "./command-attempt.ts";

export function TransferDetails({
  transfer,
  inventory,
  busy,
  onRun,
}: Readonly<{
  transfer: Transfer;
  inventory: Workspace["inventory"];
  busy: boolean;
  onRun: (
    workload: WorkloadId,
    command: MutationInput,
    success: string,
  ) => Promise<void>;
}>) {
  const releasing = transfer.status === "planned";
  const warehouse = releasing ? transfer.sourceId : transfer.destinationId;
  const otherWarehouse = warehouse === "north" ? "south" : "north";
  const verb = releasing ? "Release" : "Receive";
  const quantity = `${transfer.quantity} ${transfer.quantity === 1 ? "unit" : "units"}`;
  const stock = (id: string) =>
    inventory.find(
      (row) => row.warehouseId === id && row.skuId === transfer.skuId,
    )?.quantity;
  const action = (id: "north" | "south", primary: boolean) => (
    <button
      className={primary ? "primary" : "secondary"}
      disabled={busy}
      type="button"
      onClick={() =>
        void onRun(
          `warehouse-${id}`,
          {
            type: releasing ? "transfer.release" : "transfer.receive",
            transferId: transfer.id,
            expectedVersion: transfer.version,
          },
          `${id === "north" ? "North" : "South"} ${releasing ? "released" : "received"} the transfer.`,
        )
      }
    >
      {verb} as {id === "north" ? "North" : "South"}
    </button>
  );

  return (
    <>
      <div className="section-heading">
        <div>
          <h2>{skuLabel(transfer.skuId)}</h2>
          <p className="transfer-reference">
            Transfer <code>{transfer.id}</code> · version {transfer.version}
          </p>
        </div>
        <span className={`status ${transfer.status}`}>
          {transfer.status.replace("_", " ")}
        </span>
      </div>
      <dl className="facts">
        <div>
          <dt>From</dt>
          <dd>{warehouseLabel(transfer.sourceId)}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{warehouseLabel(transfer.destinationId)}</dd>
        </div>
        <div>
          <dt>Quantity</dt>
          <dd>{quantity}</dd>
        </div>
      </dl>
      <ol className="transfer-progress" aria-label="Transfer progress">
        {(["planned", "in_transit", "received"] as const).map((status) => (
          <li
            key={status}
            aria-current={status === transfer.status ? "step" : undefined}
          >
            {status.replace("_", " ")}
          </li>
        ))}
      </ol>
      <section className="stock-context" aria-labelledby="transfer-stock-title">
        <h3 id="transfer-stock-title">Current stock</h3>
        <dl>
          <div>
            <dt>{warehouseLabel(transfer.sourceId)}</dt>
            <dd>{stock(transfer.sourceId) ?? "Unavailable"} on hand</dd>
          </div>
          <div>
            <dt>{warehouseLabel(transfer.destinationId)}</dt>
            <dd>{stock(transfer.destinationId) ?? "Unavailable"} on hand</dd>
          </div>
        </dl>
      </section>
      {transfer.status === "received" ? (
        <p className="complete-note">Stock movement is complete.</p>
      ) : (
        <section
          className="transfer-operation"
          aria-labelledby="transfer-operation-title"
        >
          <h3 id="transfer-operation-title">
            {releasing ? "Release source stock" : "Confirm destination receipt"}
          </h3>
          <p>
            {releasing
              ? `Release ${quantity} from ${warehouseLabel(warehouse)} to put this transfer in transit.`
              : `Confirm arrival to add ${quantity} to ${warehouseLabel(warehouse)}.`}
          </p>
          {action(warehouse, true)}
          <details
            className="baseline-comparison"
            key={`${transfer.id}:${transfer.status}`}
          >
            <summary>Try another workload</summary>
            <p>
              {warehouseLabel(otherWarehouse)} is not this transfer's{" "}
              {releasing ? "source" : "destination"}. The baseline permits its
              request so we can compare the result after adding Cedarling.
            </p>
            {action(otherWarehouse, false)}
          </details>
        </section>
      )}
    </>
  );
}
