import { useEffect, useRef, useState } from "react";
import {
  Form,
  useBeforeUnload,
  useBlocker,
  useNavigation,
  useOutletContext,
} from "react-router";
import { Outcome } from "../../components/shell.tsx";
import { ProjectList } from "../../components/workspace.tsx";
import { requestServicesContext } from "../../context.ts";
import { useHydrated } from "../../hooks/use-hydrated.ts";
import { errorNotice } from "../../utils/messages.ts";
import type { WorkspaceContext } from "../workspace/layout.tsx";
import type { Route } from "./+types/project";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    const session = await runtime.requests.authenticated(request);
    const project = await runtime.workspace.readProject(
      session.principal,
      runtime.requestId,
      runtime.requests.input.identifier(
        params.organizationId,
        "organization_id",
      ),
      runtime.requests.input.identifier(params.projectId, "project_id"),
    );
    const projects = await runtime.workspace.listProjects(
      session.principal,
      runtime.requestId,
      project.organizationId,
    );
    return {
      project,
      projects,
      commandKey: runtime.requests.commandKey(),
    };
  } catch (error) {
    return runtime.requests.loaderFailure(error);
  }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    const { session, form } = await runtime.requests.mutation(request);
    const project = await runtime.workspace.writeProject(
      session.principal,
      runtime.requestId,
      {
        organizationId: runtime.requests.input.identifier(
          params.organizationId,
          "organization_id",
        ),
        projectId: runtime.requests.input.identifier(
          params.projectId,
          "project_id",
        ),
        name: runtime.requests.input.projectName(
          runtime.requests.input.field(form, "name"),
        ),
        body: runtime.requests.input.projectBody(
          runtime.requests.input.field(form, "body"),
        ),
        expectedVersion: runtime.requests.input.version(form),
        idempotencyKey: runtime.requests.input.idempotencyKey(
          runtime.requests.input.field(form, "idempotencyKey"),
        ),
      },
    );
    return { ok: true as const, project, requestId: runtime.requestId };
  } catch (error) {
    return runtime.requests.actionFailure(error);
  }
}

export default function Project({
  loaderData: data,
  actionData: result,
}: Route.ComponentProps) {
  const workspace = useOutletContext<WorkspaceContext>();
  const activeOrganization = workspace.memberships.find(
    (membership) => membership.organizationId === data.project.organizationId,
  );
  return (
    <div className="workspace-grid">
      <section className="panel project-panel">
        <header className="panel-heading">
          <div>
            <h2>{data.project.name}</h2>
            <small>
              {activeOrganization?.organizationName ??
                data.project.organizationId}
            </small>
          </div>
          <span className="count-badge">
            {data.projects.length}{" "}
            {data.projects.length === 1 ? "project" : "projects"}
          </span>
        </header>
        <ProjectList
          organizationId={data.project.organizationId}
          projects={data.projects}
          activeProjectId={data.project.id}
        />
        <ProjectEditor
          key={data.project.id}
          data={data}
          result={result}
          csrfToken={workspace.csrfToken}
        />
      </section>
    </div>
  );
}

function ProjectEditor({
  data,
  result,
  csrfToken,
}: Readonly<{
  data: Route.ComponentProps["loaderData"];
  result: Route.ComponentProps["actionData"];
  csrfToken: string;
}>) {
  const [draft, setDraft] = useState(data.project);
  const [fields, setFields] = useState({
    name: data.project.name,
    body: data.project.body,
  });
  const hydrated = useHydrated();
  const formRef = useRef<HTMLFormElement>(null);
  const appliedSave = useRef(0);
  const dirty = fields.name !== draft.name || fields.body !== draft.body;
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      currentLocation.pathname !== nextLocation.pathname &&
      !window.confirm("Discard your unsaved project changes?"),
  );
  useBeforeUnload((event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  useEffect(() => {
    if (
      result?.ok &&
      result.project.id === data.project.id &&
      result.project.version > appliedSave.current
    ) {
      appliedSave.current = result.project.version;
      setDraft(result.project);
      setFields({ name: result.project.name, body: result.project.body });
    }
  }, [result, data.project.id]);
  useEffect(() => {
    // Organization switching and logout use forms outside this editor.
    const confirmLeaving = (event: SubmitEvent) => {
      if (!dirty || event.target === formRef.current) return;
      const target = event.target;
      if (!(target instanceof HTMLFormElement)) return;
      const path = new URL(target.action, location.href).pathname;
      if (!path.endsWith("/switch") && path !== "/auth/logout") return;
      if (!window.confirm("Discard your unsaved project changes?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("submit", confirmLeaving, true);
    return () => document.removeEventListener("submit", confirmLeaving, true);
  }, [dirty]);
  return (
    <>
      <Form className="project-editor" method="post" ref={formRef}>
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="hidden" name="expectedVersion" value={draft.version} />
        <input type="hidden" name="idempotencyKey" value={data.commandKey} />
        <label>
          Project name
          <input
            name="name"
            value={fields.name}
            onChange={(event) =>
              setFields({ ...fields, name: event.currentTarget.value })
            }
            maxLength={120}
            readOnly={!hydrated || saving}
          />
        </label>
        <label>
          Description
          <textarea
            name="body"
            value={fields.body}
            onChange={(event) =>
              setFields({ ...fields, body: event.currentTarget.value })
            }
            rows={8}
            maxLength={16_384}
            readOnly={!hydrated || saving}
          />
        </label>
        <div className="editor-actions">
          <button type="submit" disabled={!hydrated || !dirty || saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!hydrated || !dirty || saving}
            onClick={() => setFields({ name: draft.name, body: draft.body })}
          >
            Cancel
          </button>
          <span className="muted" role="status">
            {dirty ? "Unsaved changes" : "No unsaved changes"}
          </span>
        </div>
      </Form>
      {result ? (
        <Outcome
          tone={result.ok ? "success" : "error"}
          requestId={result.ok ? result.requestId : undefined}
        >
          {result.ok
            ? `Changes saved. Version ${result.project.version}.`
            : errorNotice(result.error, result.requestId)}
        </Outcome>
      ) : null}
    </>
  );
}
