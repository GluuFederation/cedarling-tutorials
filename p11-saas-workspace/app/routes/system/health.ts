import { requestServicesContext } from "../../context.ts";
import type { Route } from "./+types/health";

export async function loader({ context }: Route.LoaderArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    await runtime.database.health();
  } catch (error) {
    return runtime.requests.loaderFailure(error);
  }
  return Response.json({
    status: "ok",
    service: "p11-saas-workspace",
    authorizationMode: "permissive",
  });
}
