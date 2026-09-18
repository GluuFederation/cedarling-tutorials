import type { Route } from "./+types/accept-invitation";
import { services } from "../context.ts";
import { actionFailure, field, mutation, routeId, version } from "../server.ts";
import { idempotencyKey } from "../../src/server/validation.ts";
import { badRequest } from "../../src/server/errors.ts";

export async function action({ request, context, params }: Route.ActionArgs) {
  const runtime = services(context);
  try {
    const { session, form } = await mutation(request, context);
    const token = field(form, "token");
    if (token.length < 16 || token.length > 200) {
      throw badRequest("invalid_invitation_token");
    }
    const invitation = await runtime.workspace.acceptInvitation(
      session.principal,
      runtime.requestId,
      {
        invitationId: routeId(params.invitationId, "invitation_id"),
        token,
        expectedVersion: version(form),
        idempotencyKey: idempotencyKey(field(form, "idempotencyKey")),
      },
    );
    return { ok: true as const, invitation, requestId: runtime.requestId };
  } catch (error) {
    return actionFailure(error, runtime.requestId);
  }
}
