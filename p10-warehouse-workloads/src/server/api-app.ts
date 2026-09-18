import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";
import { commandCapability } from "../shared/capabilities.ts";
import type { WorkloadCommand } from "../shared/types.ts";
import type { Authorization } from "./authorization.ts";
import type { WarehouseDatabase } from "./database.ts";
import { DomainError, notFoundHandler, requestError } from "./errors.ts";
import type { TokenVerifier, WorkloadPrincipal } from "./jwt.ts";
import { parseCommand } from "./validation.ts";

type Dependencies = Readonly<{
  database: WarehouseDatabase;
  verifier: TokenVerifier;
  authorization: Authorization;
}>;
type AuthenticatedWorkload = WorkloadPrincipal &
  Readonly<{ accessToken: string }>;

function bearer(header: string | undefined): string {
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(header ?? "");
  if (!match?.[1]) throw new DomainError("authentication_required", 401);
  return match[1];
}

function resource(command: WorkloadCommand): string {
  if ("transferId" in command) return command.transferId;
  if (command.type === "transfer.create")
    return `${command.sourceId}:${command.destinationId}`;
  return command.type === "inventory.list" ? "inventory" : "transfers";
}

function facts(command: WorkloadCommand, database: WarehouseDatabase) {
  if ("transferId" in command) {
    const current = database.getTransfer(command.transferId);
    return current
      ? {
          source: current.sourceId,
          destination: current.destinationId,
          status: current.status,
          version: current.version,
          sourceInventory:
            database.getInventory(current.sourceId, current.skuId)?.quantity ??
            0,
          destinationInventory:
            database.getInventory(current.destinationId, current.skuId)
              ?.quantity ?? 0,
        }
      : { exists: false };
  }
  if (command.type === "transfer.create") {
    return {
      source: command.sourceId,
      destination: command.destinationId,
      sku: command.skuId,
      quantity: command.quantity,
    };
  }
  return { collection: true };
}

async function authenticated(
  authorization: string | undefined,
  verifier: TokenVerifier,
): Promise<AuthenticatedWorkload> {
  try {
    const accessToken = bearer(authorization);
    return { ...(await verifier.verify(accessToken)), accessToken };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("token_invalid", 401);
  }
}

export async function createApiApp(
  dependencies: Dependencies,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 16_384 });
  await app.register(helmet);
  const authorize = async (
    command: WorkloadCommand,
    principal: AuthenticatedWorkload,
    requestId: string,
  ) => {
    const policy = commandCapability(command);
    const allowed = await dependencies.authorization.authorize({
      requestId,
      workloadId: principal.workloadId,
      capability: policy.capability,
      action: policy.action,
      accessToken: principal.accessToken,
      resourceId: resource(command),
      facts: facts(command, dependencies.database),
    });
    if (!allowed) throw new DomainError("authorization_denied", 403);
  };

  app.get("/healthz", async () => ({
    status: "ok",
    service: "p10-warehouse-api",
  }));
  app.get("/api/inventory", async (request) => {
    const principal = await authenticated(
      request.headers.authorization,
      dependencies.verifier,
    );
    const command = parseCommand({ type: "inventory.list" });
    await authorize(command, principal, request.id);
    return { inventory: dependencies.database.listInventory() };
  });
  app.get("/api/transfers", async (request) => {
    const principal = await authenticated(
      request.headers.authorization,
      dependencies.verifier,
    );
    const transfers = dependencies.database.listTransfers();
    const visible = [];
    for (const transfer of transfers) {
      const command = parseCommand({
        type: "transfer.read",
        transferId: transfer.id,
      });
      try {
        await authorize(command, principal, request.id);
        visible.push(transfer);
      } catch (error) {
        if (
          !(error instanceof DomainError) ||
          error.code !== "authorization_denied"
        )
          throw error;
      }
    }
    return { transfers: visible };
  });
  app.get<{ Params: { id: string } }>("/api/transfers/:id", async (request) => {
    const principal = await authenticated(
      request.headers.authorization,
      dependencies.verifier,
    );
    const command = parseCommand({
      type: "transfer.read",
      transferId: request.params.id,
    });
    if (command.type !== "transfer.read")
      throw new DomainError("command_invalid", 400);
    const current = dependencies.database.getTransfer(command.transferId);
    if (!current) throw new DomainError("transfer_not_found", 404);
    try {
      await authorize(command, principal, request.id);
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === "authorization_denied"
      ) {
        throw new DomainError("transfer_not_found", 404);
      }
      throw error;
    }
    return { transfer: current };
  });
  app.post("/api/transfers", async (request) => {
    const principal = await authenticated(
      request.headers.authorization,
      dependencies.verifier,
    );
    const command = parseCommand({
      type: "transfer.create",
      ...(request.body as object),
    });
    await authorize(command, principal, request.id);
    if (command.type !== "transfer.create")
      throw new DomainError("command_invalid", 400);
    return {
      transfer: dependencies.database.createTransfer({
        workloadId: principal.workloadId,
        ...command,
      }),
    };
  });
  const transition = async (
    operation: "release" | "receive",
    request: {
      body: unknown;
      params: { id: string };
      id: string;
    },
    authorizationHeader: string | undefined,
  ) => {
    const principal = await authenticated(
      authorizationHeader,
      dependencies.verifier,
    );
    const command = parseCommand({
      type: `transfer.${operation}`,
      transferId: request.params.id,
      ...(request.body as object),
    });
    if (
      (command.type !== "transfer.release" &&
        command.type !== "transfer.receive") ||
      command.type !== `transfer.${operation}`
    )
      throw new DomainError("command_invalid", 400);
    await authorize(command, principal, request.id);
    return {
      transfer: dependencies.database.transition({
        workloadId: principal.workloadId,
        transferId: command.transferId,
        operation,
        expectedVersion: command.expectedVersion,
        idempotencyKey: command.idempotencyKey,
      }),
    };
  };
  app.post<{ Params: { id: string } }>(
    "/api/transfers/:id/release",
    (request) => transition("release", request, request.headers.authorization),
  );
  app.post<{ Params: { id: string } }>(
    "/api/transfers/:id/receive",
    (request) => transition("receive", request, request.headers.authorization),
  );
  app.setNotFoundHandler(notFoundHandler);
  app.setErrorHandler((error, request, reply) => {
    const domain = requestError(error, "service_unavailable");
    if (domain.statusCode >= 500) {
      console.error("P10 Warehouse API request failed", {
        requestId: request.id,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    void reply
      .code(domain.statusCode)
      .send({ error: domain.code, requestId: request.id });
  });
  return app;
}
