import { redirect } from "react-router";
import { Login } from "../components/shell.tsx";
import { requestServicesContext } from "../context.ts";
import type { Route } from "./+types/home";

export async function loader({ request, context }: Route.LoaderArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    const session = await runtime.sessions.optional(request);
    if (!session) return null;
    const workspace = await runtime.workspace.workspace(session.principal);
    if (workspace.selection.organizationId) {
      throw redirect(
        `/organizations/${workspace.selection.organizationId}/projects`,
      );
    }
    if (workspace.memberships.length) throw redirect("/invitations");
    const approvals = await runtime.workspace.supportApprovals(
      session.principal,
    );
    throw redirect(approvals.length ? "/support" : "/invitations");
  } catch (error) {
    return runtime.requests.loaderFailure(error);
  }
}

export default function Home() {
  return <Login />;
}
