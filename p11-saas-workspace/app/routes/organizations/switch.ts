import { redirect } from "react-router";
import { requestServicesContext } from "../../context.ts";
import type { Route } from "./+types/switch";

export async function action({ request, context, params }: Route.ActionArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    const { session, form } = await runtime.requests.mutation(request);
    const organizationId = runtime.requests.input.identifier(
      params.organizationId,
      "organization_id",
    );
    await runtime.workspace.switchOrganization(
      session.principal,
      runtime.requestId,
      organizationId,
      runtime.requests.input.version(form),
      runtime.requests.input.idempotencyKey(
        runtime.requests.input.field(form, "idempotencyKey"),
      ),
    );
    return redirect(`/organizations/${organizationId}/projects`);
  } catch (error) {
    return runtime.requests.actionFailure(error);
  }
}
