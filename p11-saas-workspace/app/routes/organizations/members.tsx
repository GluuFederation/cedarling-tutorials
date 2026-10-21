import { useOutletContext } from "react-router";
import { PageHeader, TeamPanels } from "../../components/workspace.tsx";
import { requestServicesContext } from "../../context.ts";
import type { Invitation, InvitationCandidate } from "../../types/contracts.ts";
import type { WorkspaceContext } from "../workspace/layout.tsx";
import type { Route } from "./+types/members";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    const session = await runtime.requests.authenticated(request);
    const organizationId = runtime.requests.input.identifier(
      params.organizationId,
      "organization_id",
    );
    const members = await runtime.workspace.members(
      session.principal,
      runtime.requestId,
      organizationId,
    );
    let invitations: readonly Invitation[] = [];
    let candidates: readonly InvitationCandidate[] = [];
    let canInvite = true;
    try {
      const setup = await runtime.workspace.invitationSetup(
        session.principal,
        runtime.requestId,
        organizationId,
      );
      invitations = setup.invitations;
      candidates = setup.candidates;
    } catch (error) {
      if (!runtime.requests.isDenied(error)) throw error;
      canInvite = false;
    }
    return {
      organizationId,
      members,
      invitations,
      candidates,
      canInvite,
      invitationKey: runtime.requests.commandKey(),
    };
  } catch (error) {
    return runtime.requests.loaderFailure(error);
  }
}

export default function Members({ loaderData: data }: Route.ComponentProps) {
  const workspace = useOutletContext<WorkspaceContext>();
  const activeOrganization = workspace.memberships.find(
    (membership) => membership.organizationId === data.organizationId,
  );
  const organizationName =
    activeOrganization?.organizationName ?? data.organizationId;
  return (
    <div className="page">
      <PageHeader
        title="Members"
        description={`View members and invite teammates to ${organizationName}.`}
      >
        <span className="count-badge">{data.members.length} active</span>
      </PageHeader>
      <TeamPanels
        key={data.organizationId}
        organizationId={data.organizationId}
        csrfToken={workspace.csrfToken}
        selectionVersion={workspace.selection.version}
        invitationKey={data.invitationKey}
        members={data.members}
        invitations={data.invitations}
        candidates={data.candidates}
        canInvite={data.canInvite}
      />
    </div>
  );
}
