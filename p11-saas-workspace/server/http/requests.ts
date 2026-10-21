import { data, redirect } from "react-router";
import type { SessionView } from "../../app/types/contracts.ts";
import { randomToken } from "../auth/crypto.ts";
import type { SessionManager } from "../auth/session.ts";
import { AppError, databaseFailure, isDenied } from "../shared/errors.ts";
import type { Session } from "../shared/models.ts";
import {
  expectedVersion,
  idempotencyKey,
  identifier,
  invitationToken,
  inviteRole,
  projectBody,
  projectName,
} from "../shared/validation.ts";
import type { WorkspaceService } from "../workspace/service.ts";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string") throw new AppError(`invalid_${name}`, 400);
  return value;
}

export class RequestService {
  private readonly sessions: SessionManager;
  private readonly workspace: WorkspaceService;
  private readonly requestId: string;
  constructor(
    sessions: SessionManager,
    workspace: WorkspaceService,
    requestId: string,
  ) {
    this.sessions = sessions;
    this.workspace = workspace;
    this.requestId = requestId;
  }

  readonly isDenied = isDenied;

  readonly input = {
    field,
    identifier,
    idempotencyKey,
    invitationToken,
    inviteRole,
    projectBody,
    projectName,
    version: (form: FormData) =>
      expectedVersion(field(form, "expectedVersion")),
  };

  async authenticated(request: Request): Promise<Session> {
    const current = await this.sessions.optional(request);
    if (!current) throw redirect("/");
    return current;
  }

  async sessionView(
    request: Request,
    organizationId?: string,
  ): Promise<SessionView | undefined> {
    const session = await this.sessions.optional(request);
    if (!session) return undefined;
    const workspace = await this.workspace.workspace(session.principal);
    return {
      user: { name: session.principal.name },
      csrfToken: session.csrfToken,
      activeOrganizationId: workspace.selection.organizationId,
      selectionVersion: workspace.selection.version,
      memberships: workspace.memberships,
      navigationOrganizationId:
        organizationId === undefined
          ? workspace.selection.organizationId
          : identifier(organizationId, "organization_id"),
      switchKeys: Object.fromEntries(
        workspace.memberships.map((membership) => [
          membership.organizationId,
          this.commandKey(),
        ]),
      ),
    };
  }

  async mutation(
    request: Request,
  ): Promise<{ session: Session; form: FormData }> {
    const session = await this.authenticated(request);
    const form = await request.formData();
    this.sessions.requireMutation(request, session, form);
    return { session, form };
  }

  commandKey(): string {
    return randomToken(12);
  }

  actionFailure(error: unknown) {
    if (error instanceof Response) throw error;
    const failure = this.requestFailure(error);
    return data(
      { ok: false as const, error: failure.code, requestId: this.requestId },
      { status: failure.status },
    );
  }

  loaderFailure(error: unknown): never {
    if (error instanceof Response) throw error;
    const failure = this.requestFailure(error);
    throw data(
      { error: failure.code, requestId: this.requestId },
      { status: failure.status },
    );
  }

  private requestFailure(error: unknown): AppError {
    if (error instanceof AppError) return error;
    if (databaseFailure(error))
      return new AppError("database_unavailable", 503);
    console.error(`P11 request failed | ${this.requestId}`);
    return new AppError("request_failed", 500);
  }
}
