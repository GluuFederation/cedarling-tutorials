import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import type { Route } from "./+types/project";
import { services } from "../context.ts";
import {
  actionFailure,
  authenticated,
  commandKey,
  field,
  loaderFailure,
  mutation,
  routeId,
  version,
} from "../server.ts";
import {
  idempotencyKey,
  projectBody,
  projectName,
} from "../../src/server/validation.ts";
import { Outcome } from "../components/shell.tsx";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const runtime = services(context);
  try {
    const session = await authenticated(request, context);
    const project = await runtime.workspace.readProject(
      session.principal,
      runtime.requestId,
      routeId(params.organizationId, "organization_id"),
      routeId(params.projectId, "project_id"),
    );
    return { project, csrfToken: session.csrfToken, commandKey: commandKey() };
  } catch (error) {
    loaderFailure(error, runtime.requestId);
  }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const runtime = services(context);
  try {
    const { session, form } = await mutation(request, context);
    const project = await runtime.workspace.writeProject(
      session.principal,
      runtime.requestId,
      {
        organizationId: routeId(params.organizationId, "organization_id"),
        projectId: routeId(params.projectId, "project_id"),
        name: projectName(field(form, "name")),
        body: projectBody(field(form, "body")),
        expectedVersion: version(form),
        idempotencyKey: idempotencyKey(field(form, "idempotencyKey")),
      },
    );
    return { ok: true as const, project, requestId: runtime.requestId };
  } catch (error) {
    return actionFailure(error, runtime.requestId);
  }
}

export default function Project() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  return (
    <>
      <Form className="editor" method="post">
        <input type="hidden" name="_csrf" value={data.csrfToken} />
        <input
          type="hidden"
          name="expectedVersion"
          value={data.project.version}
        />
        <input type="hidden" name="idempotencyKey" value={data.commandKey} />
        <label>
          Project name
          <input name="name" defaultValue={data.project.name} maxLength={120} />
        </label>
        <label>
          Project body
          <textarea
            name="body"
            defaultValue={data.project.body}
            maxLength={16_384}
          />
        </label>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save current version"}
        </button>
      </Form>
      {result ? (
        <Outcome>
          {result.ok
            ? `Saved version ${result.project.version} · ${result.requestId}`
            : `${result.error} · ${result.requestId}`}
        </Outcome>
      ) : null}
    </>
  );
}
