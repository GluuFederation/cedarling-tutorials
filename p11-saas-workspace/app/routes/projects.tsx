import { redirect } from "react-router";
import type { Route } from "./+types/projects";
import { services } from "../context.ts";
import { authenticated, loaderFailure, routeId } from "../server.ts";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const runtime = services(context);
  try {
    const session = await authenticated(request, context);
    const organizationId = routeId(params.organizationId, "organization_id");
    const projects = await runtime.workspace.listProjects(
      session.principal,
      runtime.requestId,
      organizationId,
    );
    if (projects[0]) {
      throw redirect(
        `/organizations/${organizationId}/projects/${projects[0].id}`,
      );
    }
    return null;
  } catch (error) {
    loaderFailure(error, runtime.requestId);
  }
}

export default function Projects() {
  return <p className="muted">No project returned.</p>;
}
