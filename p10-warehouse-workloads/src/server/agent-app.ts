import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import type { AgentConfig } from "./config.ts";
import { DomainError, notFoundHandler, requestError } from "./errors.ts";
import type { WorkloadTokens } from "./oidc.ts";
import { parseCommand } from "./validation.ts";

function apiRequest(command: ReturnType<typeof parseCommand>): Readonly<{
  path: string;
  method: "GET" | "POST";
  body?: string;
}> {
  switch (command.type) {
    case "inventory.list":
      return { path: "/api/inventory", method: "GET" };
    case "transfer.list":
      return { path: "/api/transfers", method: "GET" };
    case "transfer.read":
      return {
        path: `/api/transfers/${encodeURIComponent(command.transferId)}`,
        method: "GET",
      };
    case "transfer.create": {
      const { type: _type, ...body } = command;
      return {
        path: "/api/transfers",
        method: "POST",
        body: JSON.stringify(body),
      };
    }
    case "transfer.release":
    case "transfer.receive": {
      const { type, transferId, ...body } = command;
      const operation = type === "transfer.release" ? "release" : "receive";
      return {
        path: `/api/transfers/${encodeURIComponent(transferId)}/${operation}`,
        method: "POST",
        body: JSON.stringify(body),
      };
    }
  }
}

function sameSecret(
  actual: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof actual !== "string") return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function createAgentApp(
  config: AgentConfig,
  tokens: WorkloadTokens,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 16_384 });
  app.get("/healthz", async () => ({
    status: "ok",
    service: `p10-agent-${config.workloadId}`,
  }));
  app.post("/command", async (request, reply) => {
    if (
      !sameSecret(request.headers["x-p10-control-secret"], config.controlSecret)
    ) {
      throw new DomainError("control_authentication_required", 401);
    }
    const command = parseCommand(request.body);
    const accessToken = await tokens.accessToken();
    const outgoing = apiRequest(command);
    const response = await fetch(`${config.warehouseApiUrl}${outgoing.path}`, {
      method: outgoing.method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(outgoing.body ? { "content-type": "application/json" } : {}),
      },
      ...(outgoing.body ? { body: outgoing.body } : {}),
      signal: AbortSignal.timeout(3_000),
    });
    const text = await response.text();
    if (text.length > 65_536)
      throw new Error("Warehouse API response is oversized");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("Warehouse API response is invalid");
    }
    return reply.code(response.status).send(body);
  });
  app.setNotFoundHandler(notFoundHandler);
  app.setErrorHandler((error, request, reply) => {
    const domain = requestError(error, "dependency_unavailable");
    if (domain.statusCode >= 500) {
      console.error("P10 workload agent failed", {
        requestId: request.id,
        workload: config.workloadId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    void reply
      .code(domain.statusCode)
      .send({ error: domain.code, requestId: request.id });
  });
  return app;
}
