import type { Capability } from "../shared/capabilities.ts";
import type { WorkOrder } from "../shared/types.ts";
import type { RequestEvidence } from "./api.ts";

export type OperationDetails = {
  capability: Capability;
  local?: boolean | undefined;
  server?: RequestEvidence;
};

export function TechnicalDetails({
  workOrder,
  operation,
}: Readonly<{
  workOrder: WorkOrder;
  operation: OperationDetails | undefined;
}>) {
  return (
    <details className="technical-details">
      <summary>Technical details</summary>
      <p className="version-summary">
        Work v{workOrder.workOrderVersion} · Assignment v
        {workOrder.assignmentEpoch}
      </p>
      <p className="help-text">
        Work versions increase after submissions and reviews; assignment
        versions increase when the technician changes. Both start at 1 and help
        detect outdated requests.
      </p>
      {operation && (
        <>
          <h4>Last action</h4>
          <dl className="request-details">
            <div>
              <dt>Action</dt>
              <dd>
                <code>{operation.capability}</code>
              </dd>
            </div>
            <div>
              <dt>Browser check</dt>
              <dd>
                {operation.local === undefined
                  ? "Queued earlier; not checked again"
                  : operation.local
                    ? "FAKE ALLOW"
                    : "DENY"}
              </dd>
            </div>
            <div>
              <dt>Server decision</dt>
              <dd>
                {operation.server?.decision ??
                  (operation.server?.status
                    ? "Not evaluated"
                    : "No decision received")}
              </dd>
            </div>
            <div>
              <dt>Request result</dt>
              <dd>
                {operation.server?.status
                  ? `HTTP ${operation.server.status}`
                  : operation.server
                    ? "Connection failed; outcome unknown"
                    : "Not sent yet"}
              </dd>
            </div>
            {operation.server?.requestId && (
              <div>
                <dt>Request ID</dt>
                <dd>
                  <code>{operation.server.requestId}</code>
                </dd>
              </div>
            )}
          </dl>
        </>
      )}
    </details>
  );
}
