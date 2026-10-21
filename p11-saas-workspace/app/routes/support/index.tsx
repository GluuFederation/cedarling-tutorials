import { Link, useFetcher, useOutletContext } from "react-router";
import { Shield } from "../../components/icons.tsx";
import { EmptyState, Outcome } from "../../components/shell.tsx";
import { PageHeader } from "../../components/workspace.tsx";
import { requestServicesContext } from "../../context.ts";
import { useExpiries } from "../../hooks/use-expiries.ts";
import { useHydrated } from "../../hooks/use-hydrated.ts";
import { errorNotice } from "../../utils/messages.ts";
import { displayTime } from "../../utils/time.ts";
import type { WorkspaceContext } from "../workspace/layout.tsx";
import type { Route } from "./+types/index";
import type { action as openAction } from "./open.ts";

export async function loader({ request, context }: Route.LoaderArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    const session = await runtime.requests.authenticated(request);
    const approvals = await runtime.workspace.supportApprovals(
      session.principal,
    );
    const selectedId = new URL(request.url).searchParams.get("project");
    const selected = approvals.find((item) => item.projectId === selectedId);
    const project = selected
      ? await runtime.workspace.readProject(
          session.principal,
          runtime.requestId,
          selected.organizationId,
          selected.projectId,
        )
      : undefined;
    return {
      renderedAt: Date.now(),
      approvals,
      project,
      commandKeys: Object.fromEntries(
        approvals.map((item) => [item.id, runtime.requests.commandKey()]),
      ),
    };
  } catch (error) {
    return runtime.requests.loaderFailure(error);
  }
}

export default function Support({ loaderData: data }: Route.ComponentProps) {
  const workspace = useOutletContext<WorkspaceContext>();
  const open = useFetcher<typeof openAction>();
  const hydrated = useHydrated();
  const now = useExpiries(
    data.approvals.flatMap((approval) =>
      approval.activeUntil
        ? [approval.expiresAt, approval.activeUntil]
        : [approval.expiresAt],
    ),
    data.renderedAt,
  );
  return (
    <div className="page page-narrow">
      <PageHeader
        title="Support access"
        description="Read a project covered by your support approval."
      />
      <section className="panel">
        <noscript>Enable JavaScript to open a support session.</noscript>
        {data.approvals.length ? (
          data.approvals.map((approval) => {
            const expired = Date.parse(approval.expiresAt) <= now;
            const active =
              !expired &&
              Boolean(
                approval.activeUntil && Date.parse(approval.activeUntil) > now,
              );
            return (
              <article className="support-card" key={approval.id}>
                <div className="support-heading">
                  <span className="support-mark" aria-hidden="true">
                    <Shield size={18} />
                  </span>
                  <span className="member-copy">
                    <strong>
                      {approval.projectName ?? `Project ${approval.projectId}`}
                    </strong>
                    <small>
                      {approval.organizationName ?? approval.organizationId} ·
                      read only
                    </small>
                    <small>
                      Approval {expired ? "expired" : "expires"}{" "}
                      {displayTime(approval.expiresAt)}
                    </small>
                  </span>
                  <span
                    className="state-badge"
                    data-state={
                      expired ? "expired" : active ? "active" : "inactive"
                    }
                  >
                    {expired
                      ? "Approval expired"
                      : active
                        ? "Access open"
                        : "Access closed"}
                  </span>
                </div>
                <div className="button-row">
                  <open.Form
                    action={`/support/${approval.id}/open`}
                    method="post"
                  >
                    <input
                      type="hidden"
                      name="_csrf"
                      value={workspace.csrfToken}
                    />
                    <input
                      type="hidden"
                      name="expectedVersion"
                      value={approval.version}
                    />
                    <input
                      type="hidden"
                      name="idempotencyKey"
                      value={data.commandKeys[approval.id]}
                    />
                    <button
                      type="submit"
                      disabled={expired || !hydrated || open.state !== "idle"}
                    >
                      {open.state === "submitting"
                        ? "Opening…"
                        : active
                          ? "Extend access"
                          : "Open support access"}
                    </button>
                  </open.Form>
                  {active ? (
                    <Link
                      className="secondary"
                      to={`/support?project=${approval.projectId}`}
                    >
                      Read approved project
                    </Link>
                  ) : null}
                </div>
                {active ? (
                  <p className="muted">
                    Access ends at {displayTime(approval.activeUntil ?? "")}.
                  </p>
                ) : (
                  <p className="muted">
                    {expired
                      ? "Ask for a renewed approval to continue."
                      : "Open access to start a session of up to ten minutes."}
                  </p>
                )}
              </article>
            );
          })
        ) : (
          <EmptyState icon={<Shield size={22} />} title="No support approvals">
            An approver must grant a time-boxed project scope before you can
            open a support session.
          </EmptyState>
        )}
        {data.project ? (
          <article className="project-preview">
            <h3>{data.project.name}</h3>
            <p>{data.project.body}</p>
          </article>
        ) : null}
        {open.data ? (
          <Outcome
            tone={!open.data.ok ? "error" : "success"}
            requestId={!open.data.ok ? undefined : open.data.requestId}
          >
            {!open.data.ok
              ? errorNotice(open.data.error, open.data.requestId)
              : "Support access opened."}
          </Outcome>
        ) : null}
      </section>
    </div>
  );
}
