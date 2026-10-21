import { requestServicesContext } from "../../context.ts";
import type { Route } from "./+types/issue-invitation";

export async function action({ request, context, params }: Route.ActionArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    const { session, form } = await runtime.requests.mutation(request);
    const result = await runtime.workspace.issueInvitation(
      session.principal,
      runtime.requestId,
      {
        organizationId: runtime.requests.input.identifier(
          params.organizationId,
          "organization_id",
        ),
        targetPrincipalId: runtime.requests.input.identifier(
          runtime.requests.input.field(form, "targetPrincipalId"),
          "target_principal_id",
        ),
        role: runtime.requests.input.inviteRole(
          runtime.requests.input.field(form, "role"),
        ),
        expectedSelectionVersion: runtime.requests.input.version(form),
        idempotencyKey: runtime.requests.input.idempotencyKey(
          runtime.requests.input.field(form, "idempotencyKey"),
        ),
      },
    );
    return { ok: true as const, ...result, requestId: runtime.requestId };
  } catch (error) {
    return runtime.requests.actionFailure(error);
  }
}
