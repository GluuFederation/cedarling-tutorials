import type { Route } from "./+types/auth-login";
import { services } from "../context.ts";

export function loader({ request, context }: Route.LoaderArgs) {
  return services(context).sessions.login(request);
}
