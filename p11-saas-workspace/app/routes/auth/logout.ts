import { requestServicesContext } from "../../context.ts";
import type { Route } from "./+types/logout";

export async function action({ request, context }: Route.ActionArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    return await runtime.sessions.logout(request, await request.formData());
  } catch (error) {
    return runtime.requests.actionFailure(error);
  }
}
