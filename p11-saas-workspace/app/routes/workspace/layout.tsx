import { Outlet, useRouteLoaderData } from "react-router";
import { WorkspaceSidebar } from "../../components/workspace.tsx";
import type { loader as rootLoader } from "../../root.tsx";
import type { Membership } from "../../types/contracts.ts";

export type WorkspaceContext = Readonly<{
  organizationId: string | null;
  selection: Readonly<{ organizationId: string | null; version: number }>;
  memberships: readonly Membership[];
  csrfToken: string;
  switchKeys: Readonly<Record<string, string>>;
}>;

export default function WorkspaceLayout() {
  const session = useRouteLoaderData<typeof rootLoader>("root")?.session;
  if (!session) return null;
  const workspace: WorkspaceContext = {
    organizationId: session.navigationOrganizationId,
    selection: {
      organizationId: session.activeOrganizationId,
      version: session.selectionVersion,
    },
    memberships: session.memberships,
    csrfToken: session.csrfToken,
    switchKeys: session.switchKeys,
  };
  return (
    <div className="content-shell">
      <WorkspaceSidebar {...workspace} />
      <main className="main-region">
        <Outlet context={workspace} />
      </main>
    </div>
  );
}
