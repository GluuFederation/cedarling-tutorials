import type { Route } from "./+types/issue-invitation";
import { services } from "../context.ts";
import { actionFailure, field, mutation, routeId, version } from "../server.ts";
import {
  idempotencyKey,
  identifier,
  inviteRole,
} from "../../src/server/validation.ts";

export async function action({ request, context, params }: Route.ActionArgs) {
  const runtime = services(context);
  try {
    const { session, form } = await mutation(request, context);
    const result = await runtime.workspace.issueInvitation(
      session.principal,
      runtime.requestId,
      {
        organizationId: routeId(params.organizationId, "organization_id"),
        targetPrincipalId: identifier(
          field(form, "targetPrincipalId"),
          "target_principal_id",
        ),
        role: inviteRole(field(form, "role")),
        expectedSelectionVersion: version(form),
        idempotencyKey: idempotencyKey(field(form, "idempotencyKey")),
      },
    );
    return { ok: true as const, ...result, requestId: runtime.requestId };
  } catch (error) {
    return actionFailure(error, runtime.requestId);
  }
}
