import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { runtime } from "@/src/server/runtime.ts";
import { EmptyQueue, Login } from "./components.tsx";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const services = await runtime();
  const session = await services.sessions.optional();
  if (session) {
    const requestId =
      (await headers()).get("x-request-id") ?? crypto.randomUUID();
    const articles = await services.editorial.list(session, requestId);
    if (articles[0]) redirect(`/articles/${articles[0].id}`);
    return <EmptyQueue />;
  }
  const query = await searchParams;
  return <Login expired={query.expired === "1"} />;
}
