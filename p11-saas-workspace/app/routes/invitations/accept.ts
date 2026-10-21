import { requestServicesContext } from "../../context.ts";
import type { Route } from "./+types/accept";

export async function action({ request, context, params }: Route.ActionArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    const { session, form } = await runtime.requests.mutation(request);
    const token = runtime.requests.input.invitationToken(
      runtime.requests.input.field(form, "token"),
    );
    const invitation = await runtime.workspace.acceptInvitation(
      session.principal,
      runtime.requestId,
      {
        invitationId: runtime.requests.input.identifier(
          params.invitationId,
          "invitation_id",
        ),
        token,
        expectedVersion: runtime.requests.input.version(form),
        idempotencyKey: runtime.requests.input.idempotencyKey(
          runtime.requests.input.field(form, "idempotencyKey"),
        ),
      },
    );
    return { ok: true as const, invitation, requestId: runtime.requestId };
  } catch (error) {
    return runtime.requests.actionFailure(error);
  }
}
