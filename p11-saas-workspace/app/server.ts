import { data, redirect, type RouterContextProvider } from "react-router";
import { services } from "./context.ts";
import { AppError } from "../src/server/errors.ts";
import { randomToken } from "../src/server/crypto.ts";
import { identifier } from "../src/server/validation.ts";
import type { Session } from "../src/server/models.ts";
import type { SessionView } from "../src/shared/contracts.ts";

export async function authenticated(
  request: Request,
  context: Readonly<RouterContextProvider>,
): Promise<Session> {
  const current = await services(context).sessions.optional(request);
  if (!current) throw redirect("/");
  return current;
}

export async function sessionView(
  request: Request,
  context: Readonly<RouterContextProvider>,
): Promise<SessionView | undefined> {
  const runtime = services(context);
  const session = await runtime.sessions.optional(request);
  if (!session) return undefined;
  const workspace = await runtime.workspace.workspace(session.principal);
  return {
    user: { id: session.principal.id, name: session.principal.name },
    csrfToken: session.csrfToken,
    expiresAt: new Date(session.expiresAt).toISOString(),
    activeOrganizationId: workspace.selection.organizationId,
    selectionVersion: workspace.selection.version,
    memberships: workspace.memberships,
  };
}

export async function mutation(
  request: Request,
  context: Readonly<RouterContextProvider>,
): Promise<{ session: Session; form: FormData }> {
  const runtime = services(context);
  const session = await authenticated(request, context);
  const form = await request.formData();
  runtime.sessions.requireMutation(request, session, form);
  return { session, form };
}

export function field(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string") throw new AppError(`invalid_${name}`, 400);
  return value;
}

export function version(form: FormData): number {
  const value = field(form, "expectedVersion");
  if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new AppError("invalid_expected_version", 400);
  }
  return Number(value);
}

export function commandKey(): string {
  return randomToken(12);
}

export function actionFailure(error: unknown, requestId: string) {
  if (error instanceof Response) throw error;
  if (error instanceof AppError) {
    return data(
      { ok: false as const, error: error.code, requestId },
      { status: error.status },
    );
  }
  throw error;
}

export function loaderFailure(error: unknown, requestId: string): never {
  if (error instanceof Response) throw error;
  if (error instanceof AppError) {
    throw data({ error: error.code, requestId }, { status: error.status });
  }
  throw error;
}

export function routeId(value: string | undefined, name: string): string {
  return identifier(value, name);
}
