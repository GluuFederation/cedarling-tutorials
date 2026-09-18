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
  requestId: string,
): string {
  const articleId = String(form.get("articleId") ?? "");
  const params = new URLSearchParams({ outcome, request: requestId });
  return `/articles/${encodeURIComponent(articleId)}?${params}`;
}

async function execute(operation: Operation, form: FormData): Promise<never> {
  const services = await runtime();
  const requestId =
    (await headers()).get("x-request-id") ?? crypto.randomUUID();
  let outcome = `${operation}-complete`;
  try {
    const session = await services.sessions.requireMutation(form);
    if (operation === "save") {
      const revisionId = await services.editorial.saveDraft(
        session,
        form,
        requestId,
      );
      outcome = "draft-saved";
      revalidatePath(`/articles/${String(form.get("articleId"))}`);
      const params = new URLSearchParams({
        revision: revisionId,
        outcome,
        request: requestId,
      });
      redirect(
        `/articles/${encodeURIComponent(String(form.get("articleId")))}?${params}`,
      );
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
  redirect(destination(form, outcome, requestId));
}

export const saveDraft = async (form: FormData) => execute("save", form);
export const submitRevision = async (form: FormData) => execute("submit", form);
export const approveRevision = async (form: FormData) =>
  execute("approve", form);
export const rejectRevision = async (form: FormData) => execute("reject", form);
export const publishRevision = async (form: FormData) =>
  execute("publish", form);
