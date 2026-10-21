import { requestServicesContext } from "../../context.ts";
import type { Route } from "./+types/login";

export async function loader({ request, context }: Route.LoaderArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    return await runtime.sessions.login(request);
  } catch (error) {
    return runtime.requests.loaderFailure(error);
  }
}
