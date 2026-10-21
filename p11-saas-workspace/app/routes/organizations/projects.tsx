import { redirect } from "react-router";
import { Folder } from "../../components/icons.tsx";
import { EmptyState } from "../../components/shell.tsx";
import { requestServicesContext } from "../../context.ts";
import type { Route } from "./+types/projects";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    const session = await runtime.requests.authenticated(request);
    const organizationId = runtime.requests.input.identifier(
      params.organizationId,
      "organization_id",
    );
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
    return runtime.requests.loaderFailure(error);
  }
}

export default function Projects() {
  return (
    <div className="page">
      <EmptyState icon={<Folder size={22} />} title="No projects available">
        Choose another workspace to continue.
      </EmptyState>
    </div>
  );
}
