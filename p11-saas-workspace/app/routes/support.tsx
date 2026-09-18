import { Link, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/support";
import { services } from "../context.ts";
import { authenticated, commandKey, loaderFailure } from "../server.ts";
import { Outcome } from "../components/shell.tsx";

export async function loader({ request, context }: Route.LoaderArgs) {
  const runtime = services(context);
  try {
    const session = await authenticated(request, context);
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
      approvals,
      project,
      csrfToken: session.csrfToken,
      commandKeys: Object.fromEntries(
        approvals.map((item) => [item.id, commandKey()]),
      ),
    };
  } catch (error) {
    loaderFailure(error, runtime.requestId);
  }
}

export default function Support() {
  const data = useLoaderData<typeof loader>();
  const open = useFetcher();
  return (
    <main className="main-region">
      <section className="panel centered-panel">
        <h2>Approved support scope</h2>
        {data.approvals.map((approval) => (
          <article className="support-card" key={approval.id}>
            <strong>{approval.projectId} · read only</strong>
            <span>
              Expires {new Date(approval.expiresAt).toLocaleTimeString()}
            </span>
            <div className="button-row">
              <open.Form action={`/support/${approval.id}/open`} method="post">
                <input type="hidden" name="_csrf" value={data.csrfToken} />
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
                <button type="submit" disabled={open.state !== "idle"}>
                  {open.state === "submitting"
                    ? "Opening…"
                    : "Open exact scope"}
                </button>
              </open.Form>
              {approval.activeUntil ? (
                <Link
                  className="secondary"
                  to={`/support?project=${approval.projectId}`}
                >
                  Read approved project
                </Link>
              ) : null}
            </div>
          </article>
        ))}
        {data.project ? (
          <article className="project-preview">
            <h3>{data.project.name}</h3>
            <p>{data.project.body}</p>
          </article>
        ) : null}
        {open.data && typeof open.data === "object" ? (
          <Outcome>
            {"error" in open.data
              ? `${String(open.data.error)} · ${String(open.data.requestId)}`
              : "Exact support scope opened."}
          </Outcome>
        ) : null}
      </section>
    </main>
  );
}
