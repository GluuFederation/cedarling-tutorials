import type { Route } from "./+types/auth-logout";
import { services } from "../context.ts";

export async function action({ request, context }: Route.ActionArgs) {
  return services(context).sessions.logout(request, await request.formData());
}
