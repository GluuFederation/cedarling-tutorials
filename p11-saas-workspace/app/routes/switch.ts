import { redirect } from "react-router";
import type { Route } from "./+types/switch";
import { services } from "../context.ts";
import { actionFailure, field, mutation, routeId, version } from "../server.ts";
import { idempotencyKey } from "../../src/server/validation.ts";

export async function action({ request, context, params }: Route.ActionArgs) {
  const runtime = services(context);
  try {
    const { session, form } = await mutation(request, context);
    const organizationId = routeId(params.organizationId, "organization_id");
    await runtime.workspace.switchOrganization(
      session.principal,
      runtime.requestId,
      organizationId,
      version(form),
      idempotencyKey(field(form, "idempotencyKey")),
    );
    return redirect(`/organizations/${organizationId}/projects`);
  } catch (error) {
    return actionFailure(error, runtime.requestId);
  }
}
