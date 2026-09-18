import type { Route } from "./+types/auth-callback";
import { services } from "../context.ts";

export function loader({ request, context }: Route.LoaderArgs) {
  return services(context).sessions.callback(request);
}
