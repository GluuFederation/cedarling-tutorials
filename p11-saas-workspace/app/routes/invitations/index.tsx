import { Link, useFetcher, useOutletContext } from "react-router";
import { Inbox } from "../../components/icons.tsx";
import { EmptyState, Outcome } from "../../components/shell.tsx";
import { OpenWorkspace, PageHeader } from "../../components/workspace.tsx";
import { requestServicesContext } from "../../context.ts";
import { useExpiries } from "../../hooks/use-expiries.ts";
import { useHydrated } from "../../hooks/use-hydrated.ts";
import { errorNotice } from "../../utils/messages.ts";
import { displayTime } from "../../utils/time.ts";
import type { WorkspaceContext } from "../workspace/layout.tsx";
import type { Route } from "./+types/index";
import type { action as acceptAction } from "./accept.ts";

export async function loader({ request, context }: Route.LoaderArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    const session = await runtime.requests.authenticated(request);
    const invitations = await runtime.workspace.invitationsFor(
      session.principal,
    );
    return {
      renderedAt: Date.now(),
      invitations,
      commandKeys: Object.fromEntries(
        invitations.map((item) => [item.id, runtime.requests.commandKey()]),
      ),
    };
  } catch (error) {
    return runtime.requests.loaderFailure(error);
  }
}

export default function Invitations({
  loaderData: data,
}: Route.ComponentProps) {
  const workspace = useOutletContext<WorkspaceContext>();
  const accept = useFetcher<typeof acceptAction>();
  const hydrated = useHydrated();
  const now = useExpiries(
    data.invitations
      .filter((item) => item.state === "pending")
      .map((item) => item.expiresAt),
    data.renderedAt,
  );
  return (
    <div className="page page-narrow">
      <PageHeader
        title="Your invitations"
        description="Accept a workspace invitation with its one-time token."
      />
      {!workspace.selection.organizationId && workspace.memberships.length ? (
        <p className="muted">
          Choose a workspace from the menu, or open an accepted invitation
          below.
        </p>
      ) : null}
      <section className="panel">
        <noscript>Enable JavaScript to accept an invitation.</noscript>
        {data.invitations.length ? (
          data.invitations.map((item) => {
            const state =
              item.state === "pending" && Date.parse(item.expiresAt) <= now
                ? "expired"
                : item.state;
            const membership = workspace.memberships.find(
              (member) => member.organizationId === item.organizationId,
            );
            return (
              <article className="invite-card" key={item.id}>
                <div className="invite-heading">
                  <span className="member-copy">
                    <strong>
                      {item.organizationName ?? item.organizationId}
                    </strong>
                    <small>Invited as {item.role}</small>
                  </span>
                  <span className="state-badge" data-state={state}>
                    {state}
                  </span>
                </div>
                {state === "pending" ? (
                  <accept.Form
                    action={`/invitations/${item.id}/accept`}
                    method="post"
                  >
                    <p className="muted">
                      Expires {displayTime(item.expiresAt)}
                    </p>
                    <input
                      type="hidden"
                      name="_csrf"
                      value={workspace.csrfToken}
                    />
                    <input
                      type="hidden"
                      name="expectedVersion"
                      value={item.version}
                    />
                    <input
                      type="hidden"
                      name="idempotencyKey"
                      value={data.commandKeys[item.id]}
                    />
                    <label>
                      One-time invitation token
                      <input
                        name="token"
                        placeholder="Paste the one-time token"
                        minLength={16}
                        maxLength={200}
                        autoComplete="off"
                        spellCheck={false}
                        required
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={!hydrated || accept.state !== "idle"}
                    >
                      {accept.state === "submitting"
                        ? "Accepting…"
                        : "Accept invitation"}
                    </button>
                  </accept.Form>
                ) : state === "accepted" ? (
                  <>
                    <p>
                      You accepted this invitation.
                      {membership
                        ? ""
                        : " Ask an admin for a new invitation if you need access again."}
                    </p>
                    {membership ? (
                      workspace.selection.organizationId ===
                      item.organizationId ? (
                        <Link
                          className="secondary"
                          to={`/organizations/${item.organizationId}/projects`}
                        >
                          Go to workspace
                        </Link>
                      ) : (
                        <OpenWorkspace
                          organizationId={item.organizationId}
                          organizationName={
                            item.organizationName ?? item.organizationId
                          }
                          csrfToken={workspace.csrfToken}
                          selectionVersion={workspace.selection.version}
                          commandKey={
                            workspace.switchKeys[item.organizationId] ?? ""
                          }
                        />
                      )
                    ) : null}
                  </>
                ) : (
                  <p>
                    {state === "expired"
                      ? `This invitation expired ${displayTime(item.expiresAt)}.`
                      : "This invitation was revoked."}{" "}
                    Ask a workspace admin for a new invitation.
                  </p>
                )}
              </article>
            );
          })
        ) : (
          <EmptyState icon={<Inbox size={22} />} title="No invitations">
            Ask a workspace admin to invite you, then return here with the
            one-time token.
          </EmptyState>
        )}
        {accept.data ? (
          <Outcome
            tone={!accept.data.ok ? "error" : "success"}
            requestId={!accept.data.ok ? undefined : accept.data.requestId}
          >
            {!accept.data.ok
              ? errorNotice(accept.data.error, accept.data.requestId)
              : "Invitation accepted. Choose a workspace to continue."}
          </Outcome>
        ) : null}
      </section>
    </div>
  );
}
