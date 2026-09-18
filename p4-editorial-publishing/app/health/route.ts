import { runtime } from "@/src/server/runtime.ts";

export async function GET() {
  await runtime();
  return Response.json(
    { status: "ok", service: "p4-editorial-publishing" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
