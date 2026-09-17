import { useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/invitations";
import { services } from "../context.ts";
import { authenticated, commandKey, loaderFailure } from "../server.ts";
import { Outcome } from "../components/shell.tsx";

export async function loader({ request, context }: Route.LoaderArgs) {
  const runtime = services(context);
  try {
    const session = await authenticated(request, context);
    const invitations = await runtime.workspace.invitationsFor(
      session.principal,
    );
    return {
      csrfToken: session.csrfToken,
      invitations,
      commandKeys: Object.fromEntries(
        invitations.map((item) => [item.id, commandKey()]),
      ),
    };
  } catch (error) {
    loaderFailure(error, runtime.requestId);
  }
}

export default function Invitations() {
  const data = useLoaderData<typeof loader>();
  const accept = useFetcher();
  return (
    <main className="main-region">
      <section className="panel centered-panel">
        <h2>Your invitations</h2>
        {data.invitations.length ? (
          data.invitations.map((item) => (
            <accept.Form
              className="invite-card"
              action={`/invitations/${item.id}/accept`}
              method="post"
              key={item.id}
            >
              <strong>{item.organizationId}</strong>
              <span>
                {item.role} · {item.state} · v{item.version}
              </span>
              <input type="hidden" name="_csrf" value={data.csrfToken} />
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
                disabled={item.state !== "pending" || accept.state !== "idle"}
              >
                {accept.state === "submitting"
                  ? "Accepting…"
                  : "Accept invitation"}
              </button>
            </accept.Form>
          ))
        ) : (
          <p className="muted">No invitations.</p>
        )}
        {accept.data && typeof accept.data === "object" ? (
          <Outcome>
            {"error" in accept.data
              ? `${String(accept.data.error)} · ${String(accept.data.requestId)}`
              : "Invitation accepted once. Organization was not selected."}
          </Outcome>
        ) : null}
      </section>
    </main>
  );
}
