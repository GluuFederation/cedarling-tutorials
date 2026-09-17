import type { Route } from "./+types/open-support";
import { services } from "../context.ts";
import { actionFailure, field, mutation, routeId, version } from "../server.ts";
import { idempotencyKey } from "../../src/server/validation.ts";

export async function action({ request, context, params }: Route.ActionArgs) {
  const runtime = services(context);
  try {
    const { session, form } = await mutation(request, context);
    const approval = await runtime.workspace.openSupport(
      session.principal,
      runtime.requestId,
      routeId(params.approvalId, "approval_id"),
      version(form),
      idempotencyKey(field(form, "idempotencyKey")),
    );
    return { ok: true as const, approval, requestId: runtime.requestId };
  } catch (error) {
    return actionFailure(error, runtime.requestId);
  }
}
