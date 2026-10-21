import { requestServicesContext } from "../../context.ts";
import type { Route } from "./+types/open";

export async function action({ request, context, params }: Route.ActionArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    const { session, form } = await runtime.requests.mutation(request);
    const approval = await runtime.workspace.openSupport(
      session.principal,
      runtime.requestId,
      runtime.requests.input.identifier(params.approvalId, "approval_id"),
      runtime.requests.input.version(form),
      runtime.requests.input.idempotencyKey(
        runtime.requests.input.field(form, "idempotencyKey"),
      ),
    );
    return { ok: true as const, approval, requestId: runtime.requestId };
  } catch (error) {
    return runtime.requests.actionFailure(error);
  }
}
