import { Link, useOutletContext } from "react-router";
import { PageHeader } from "../../components/workspace.tsx";
import { requestServicesContext } from "../../context.ts";
import type { WorkspaceContext } from "../workspace/layout.tsx";
import type { Route } from "./+types/billing";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    const session = await runtime.requests.authenticated(request);
    const organizationId = runtime.requests.input.identifier(
      params.organizationId,
      "organization_id",
    );
    const billing = await runtime.workspace.billing(
      session.principal,
      runtime.requestId,
      organizationId,
    );
    return {
      organizationId,
      billing,
    };
  } catch (error) {
    return runtime.requests.loaderFailure(error);
  }
}

export default function Billing({
  loaderData: { billing, organizationId },
}: Route.ComponentProps) {
  const { activeSeats } = billing;
  const workspace = useOutletContext<WorkspaceContext>();
  const organizationName =
    workspace?.memberships.find(
      (membership) => membership.organizationId === organizationId,
    )?.organizationName ?? organizationId;
  const seatUsage =
    billing.seats > 0
      ? Math.min(100, Math.round((activeSeats / billing.seats) * 100))
      : 0;
  return (
    <div className="page">
      <PageHeader
        title="Billing"
        description={`Plan and seat usage for ${organizationName}.`}
      >
        <Link
          className="secondary"
          to={`/organizations/${organizationId}/projects`}
        >
          Return to projects
        </Link>
      </PageHeader>
      <div className="stat-row">
        <div className="stat-card">
          <span className="eyebrow">Plan</span>
          <strong>{billing.plan}</strong>
        </div>
        <div className="stat-card">
          <span className="eyebrow">Seats</span>
          <strong>
            {activeSeats}
            <small> / {billing.seats}</small>
          </strong>
        </div>
        <div className="stat-card">
          <span className="eyebrow">Monthly</span>
          <strong>${(billing.monthlyCents / 100).toFixed(2)}</strong>
        </div>
      </div>
      <section className="panel">
        <header className="panel-heading">
          <div>
            <h2>Seat usage</h2>
            <small>Based on active workspace members</small>
          </div>
          <span className="count-badge">{seatUsage}%</span>
        </header>
        <meter
          className="meter"
          aria-label="Seat usage"
          min={0}
          max={billing.seats || 1}
          value={activeSeats}
        >
          {seatUsage}%
        </meter>
        <p className="muted billing-note">
          {activeSeats} active members out of {billing.seats} seats.
        </p>
      </section>
    </div>
  );
}
