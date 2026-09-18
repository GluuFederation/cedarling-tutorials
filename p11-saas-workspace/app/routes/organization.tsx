import { Link, Outlet, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/organization";
import { services } from "../context.ts";
import {
  authenticated,
  commandKey,
  loaderFailure,
  routeId,
} from "../server.ts";
import { Outcome } from "../components/shell.tsx";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const runtime = services(context);
  try {
    const session = await authenticated(request, context);
    const organizationId = routeId(params.organizationId, "organization_id");
    const [workspace, projects, members, invitations] = await Promise.all([
      runtime.workspace.workspace(session.principal),
      runtime.workspace.listProjects(
        session.principal,
        runtime.requestId,
        organizationId,
      ),
      runtime.workspace.members(
        session.principal,
        runtime.requestId,
        organizationId,
      ),
      runtime.workspace.invitations(
        session.principal,
        runtime.requestId,
        organizationId,
      ),
    ]);
    return {
      organizationId,
      projects,
      members,
      invitations,
      memberships: workspace.memberships,
      selection: workspace.selection,
      csrfToken: session.csrfToken,
      switchKeys: Object.fromEntries(
        workspace.memberships.map((membership) => [
          membership.organizationId,
          commandKey(),
        ]),
      ),
      invitationKey: commandKey(),
    };
  } catch (error) {
    loaderFailure(error, runtime.requestId);
  }
}

export default function Organization() {
  const data = useLoaderData<typeof loader>();
  const invitation = useFetcher();
  const switcher = useFetcher();
  const activeMembership = data.memberships.find(
    (item) => item.organizationId === data.organizationId,
  );
  return (
    <div className="content-shell">
      <aside className="organization-rail" aria-label="Organizations">
        <h2>Organizations</h2>
        {data.memberships.map((membership) => (
          <switcher.Form
            action={`/organizations/${membership.organizationId}/switch`}
            method="post"
            key={membership.organizationId}
          >
            <input type="hidden" name="_csrf" value={data.csrfToken} />
            <input
              type="hidden"
              name="expectedVersion"
              value={data.selection.version}
            />
            <input
              type="hidden"
              name="idempotencyKey"
              value={data.switchKeys[membership.organizationId]}
            />
            <button
              type="submit"
              className={
                membership.organizationId === data.selection.organizationId
                  ? "organization-option active"
                  : "organization-option"
              }
            >
              <strong>{membership.organizationName}</strong>
              <span>{membership.role}</span>
            </button>
          </switcher.Form>
        ))}
        <Link to="/invitations">Invitations</Link>
        {switcher.data && typeof switcher.data === "object" ? (
          <Outcome>
            {"error" in switcher.data
              ? `${String(switcher.data.error)} · ${String(switcher.data.requestId)}`
              : "Organization switched."}
          </Outcome>
        ) : null}
      </aside>
      <main className="main-region">
        <div className="workspace-grid">
          <section className="panel project-panel">
            <header className="panel-heading">
              <div>
                <h2>Projects</h2>
                <small>
                  {activeMembership?.organizationName ?? data.organizationId}
                </small>
              </div>
              <Link
                className="secondary"
                to={`/organizations/${data.organizationId}/billing`}
              >
                Billing
              </Link>
            </header>
            <nav className="project-list" aria-label="Projects">
              {data.projects.map((project) => (
                <Link
                  key={project.id}
                  to={`/organizations/${data.organizationId}/projects/${project.id}`}
                >
                  {project.name} <small>v{project.version}</small>
                </Link>
              ))}
            </nav>
            <Outlet />
          </section>
          <aside className="side-stack">
            <section className="panel">
              <h2>Members</h2>
              <ul className="plain-list">
                {data.members.map((member) => (
                  <li
                    key={
                      member.principalId ??
                      `${member.organizationId}-${member.role}`
                    }
                  >
                    <span>{member.principalName ?? "Current member"}</span>
                    <strong>{member.role}</strong>
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel">
              <h2>Invitations</h2>
              {data.invitations.length ? (
                data.invitations.map((item) => (
                  <p key={item.id}>
                    {item.targetName} · {item.role} · {item.state}
                  </p>
                ))
              ) : (
                <p className="muted">No invitations.</p>
              )}
              <invitation.Form
                className="compact-form"
                action={`/organizations/${data.organizationId}/invitations`}
                method="post"
              >
                <input type="hidden" name="_csrf" value={data.csrfToken} />
                <input
                  type="hidden"
                  name="expectedVersion"
                  value={data.selection.version}
                />
                <input
                  type="hidden"
                  name="idempotencyKey"
                  value={data.invitationKey}
                />
                <label>
                  Mapped identity
                  <select name="targetPrincipalId" defaultValue="user-lena">
                    <option value="user-lena">Lena</option>
                    <option value="user-imani">Imani</option>
                  </select>
                </label>
                <label>
                  Bounded role
                  <select name="role" defaultValue="viewer">
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                </label>
                <button type="submit" disabled={invitation.state !== "idle"}>
                  {invitation.state === "submitting"
                    ? "Issuing…"
                    : "Issue 15-minute invitation"}
                </button>
              </invitation.Form>
            </section>
            {invitation.data && typeof invitation.data === "object" ? (
              <Outcome>
                {"token" in invitation.data
                  ? `Copy the one-time token now: ${String(invitation.data.token)}`
                  : "error" in invitation.data
                    ? `${String(invitation.data.error)} · ${String(invitation.data.requestId)}`
                    : "Invitation request completed."}
              </Outcome>
            ) : null}
          </aside>
        </div>
      </main>
    </div>
  );
}
