import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { runtime } from "@/src/server/runtime.ts";
import { ArticleForm } from "./article-form.tsx";

export default async function NewArticlePage() {
  const services = await runtime();
  const session = await services.sessions.optional();
  if (!session) redirect("/?expired=1");
  const requestId =
    (await headers()).get("x-request-id") ?? crypto.randomUUID();
  const allowed = await services.editorial.canCreate(session, requestId);
  return (
    <main className="landing">
      <section className="login-panel" aria-labelledby="new-article-title">
        <h2 id="new-article-title">New article</h2>
        <p>
          Create a draft in your tenant. Another editor must review it before
          publication.
        </p>
        <ArticleForm csrfToken={session.csrfToken} allowed={allowed} />
      </section>
    </main>
  );
}
