import { resolve } from "node:path";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { type WorkloadId, workloadIds } from "../shared/catalog.ts";
import type { WorkloadCommand, Workspace } from "../shared/types.ts";
import type { ConsoleConfig } from "./config.ts";
import { DomainError, notFoundHandler, requestError } from "./errors.ts";
import { parseCommand } from "./validation.ts";

async function agentCommand(
  config: ConsoleConfig,
  workloadId: WorkloadId,
  command: WorkloadCommand,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${config.agentUrls[workloadId]}/command`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-p10-control-secret": config.controlSecret,
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(4_000),
  });
  const text = await response.text();
  if (text.length > 65_536) throw new Error("Workload response is oversized");
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    throw new Error("Workload response is invalid");
  }
}

export async function createConsoleApp(
  config: ConsoleConfig,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 16_384 });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
      },
    },
  });
  await app.register(fastifyStatic, {
    root: resolve("dist/web"),
    wildcard: false,
  });

  app.get("/healthz", async () => ({
    status: "ok",
    service: "p10-warehouse-workloads",
  }));
  app.get("/api/workspace", async () => {
    const [inventoryResult, transferResult] = await Promise.all([
      agentCommand(config, "inventory-auditor", { type: "inventory.list" }),
      agentCommand(config, "transfer-planner", { type: "transfer.list" }),
    ]);
    if (inventoryResult.status !== 200 || transferResult.status !== 200) {
      throw new Error("Workspace dependencies rejected their requests");
    }
    const inventory = inventoryResult.body as {
      inventory?: Workspace["inventory"];
    };
    const transfers = transferResult.body as {
      transfers?: Workspace["transfers"];
    };
    if (
      !Array.isArray(inventory.inventory) ||
      !Array.isArray(transfers.transfers)
    ) {
      throw new Error("Workspace dependency response is incomplete");
    }
    return {
      inventory: inventory.inventory,
      transfers: transfers.transfers,
    } satisfies Workspace;
  });
  app.post<{ Params: { workloadId: string } }>(
    "/api/workloads/:workloadId/commands",
    async (request, reply) => {
      if (request.headers.origin !== config.baseUrl) {
        throw new DomainError("origin_invalid", 403);
      }
      if (!workloadIds.has(request.params.workloadId as WorkloadId)) {
        throw new DomainError("workload_not_found", 404);
      }
      const result = await agentCommand(
        config,
        request.params.workloadId as WorkloadId,
        parseCommand(request.body),
      );
      return reply.code(result.status).send(result.body);
    },
  );
  app.setNotFoundHandler(notFoundHandler);
  app.setErrorHandler((error, request, reply) => {
    const domain = requestError(error, "service_unavailable");
    if (domain.statusCode >= 500) {
      console.error("P10 console request failed", {
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
