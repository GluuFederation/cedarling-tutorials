import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/billing";
import { services } from "../context.ts";
import { authenticated, loaderFailure, routeId } from "../server.ts";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const runtime = services(context);
  try {
    const session = await authenticated(request, context);
    const organizationId = routeId(params.organizationId, "organization_id");
    return {
      organizationId,
      billing: await runtime.workspace.billing(
        session.principal,
        runtime.requestId,
        organizationId,
      ),
    };
  } catch (error) {
    loaderFailure(error, runtime.requestId);
  }
}

export default function Billing() {
  const { billing, organizationId } = useLoaderData<typeof loader>();
  return (
    <article className="project-preview">
      <h3>Billing projection</h3>
      <p>
        {billing.plan} · {billing.seats} seats · $
        {(billing.monthlyCents / 100).toFixed(2)}
      </p>
      <Link to={`/organizations/${organizationId}/projects`}>
        Return to projects
      </Link>
    </article>
  );
}
