import type { Route } from "./+types/health";
import { services } from "../context.ts";

export async function loader({ context }: Route.LoaderArgs) {
  const runtime = services(context);
  await runtime.database.health();
  return Response.json({
    status: "ok",
    service: "p11-saas-workspace",
    authorizationMode: "permissive",
  });
}
