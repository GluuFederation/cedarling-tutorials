"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAppError } from "@/src/server/errors.ts";
import { runtime } from "@/src/server/runtime.ts";

type Operation = "save" | "submit" | "approve" | "reject" | "publish";

function destination(
  form: FormData,
  outcome: string,
  revision?: string,
): string {
  const articleId = String(form.get("articleId") ?? "");
  const params = new URLSearchParams({ outcome });
  if (revision) params.set("revision", revision);
  return `/articles/${encodeURIComponent(articleId)}?${params}`;
}

async function execute(operation: Operation, form: FormData): Promise<never> {
  const services = await runtime();
  const requestId =
    (await headers()).get("x-request-id") ?? crypto.randomUUID();
  let outcome = `${operation}-complete`;
  let revisionId: string | undefined;
  try {
    const session = await services.sessions.requireMutation(form);
    if (operation === "save") {
      revisionId = await services.editorial.saveDraft(session, form, requestId);
      outcome = "draft-saved";
    }
    if (operation === "submit")
      await services.editorial.submit(session, form, requestId);
    if (operation === "approve")
      await services.editorial.review(session, form, requestId, "approved");
    if (operation === "reject")
      await services.editorial.review(session, form, requestId, "rejected");
    if (operation === "publish")
      await services.editorial.publish(session, form, requestId);
    revalidatePath(`/articles/${String(form.get("articleId"))}`);
  } catch (error) {
    if (isAppError(error)) outcome = `error-${error.code.toLowerCase()}`;
    else throw error;
  }
  redirect(destination(form, outcome, revisionId));
}

export async function createArticle(
  _previous: { error: string | null },
  form: FormData,
): Promise<{ error: string | null }> {
  const services = await runtime();
  const requestId =
    (await headers()).get("x-request-id") ?? crypto.randomUUID();
  let articleId: string;
  try {
    const session = await services.sessions.requireMutation(form);
    articleId = await services.editorial.create(session, form, requestId);
  } catch (error) {
    const category = isAppError(error) ? error.code : "INTERNAL_ERROR";
    return {
      error:
        category === "INVALID_REQUEST"
          ? "Enter a title (1–160 characters) and body (up to 32,768 UTF-8 bytes)."
          : category === "FORBIDDEN"
            ? "This account cannot create an article."
            : category === "REQUEST_INTEGRITY_FAILED"
              ? "The request could not be verified. Refresh and try again."
              : category === "AUTHENTICATION_REQUIRED"
                ? "Your session expired. Sign in again."
                : "The article could not be created. Try again.",
    };
  }
  revalidatePath("/");
  redirect(`/articles/${articleId}?outcome=article-created`);
}

export const saveDraft = async (form: FormData) => execute("save", form);
export const submitRevision = async (form: FormData) => execute("submit", form);
export const approveRevision = async (form: FormData) =>
  execute("approve", form);
export const rejectRevision = async (form: FormData) => execute("reject", form);
export const publishRevision = async (form: FormData) =>
  execute("publish", form);
