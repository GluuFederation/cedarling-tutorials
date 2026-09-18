import { mkdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  WORKLOADS,
  type WorkloadId,
  workloadAgentPort,
  workloadEnvironmentPrefix,
  workloadIds,
} from "../shared/catalog.ts";

type Bind = Readonly<{ host: string; port: number }>;
export type ConsoleConfig = Bind &
  Readonly<{
    baseUrl: string;
    controlSecret: string;
    agentUrls: Readonly<Record<WorkloadId, string>>;
  }>;
export type ApiConfig = Bind &
  Readonly<{
    issuer: string;
    apiResource: string;
    dataDirectory: string;
    workloadClientIds: Readonly<Record<WorkloadId, string>>;
  }>;
export type AgentConfig = Bind &
  Readonly<{
    workloadId: WorkloadId;
    controlSecret: string;
    issuer: string;
    apiResource: string;
    warehouseApiUrl: string;
    clientId: string;
    clientSecret: string;
  }>;

function port(value: string | undefined, fallback: number, name: string) {
  const result = Number(value ?? fallback);
  if (!Number.isSafeInteger(result) || result < 1 || result > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return result;
}

function host(value: string | undefined, name: string): string {
  const result = value?.trim() || "127.0.0.1";
  if (result !== "127.0.0.1" && result !== "0.0.0.0") {
    throw new Error(`${name} must be a local or container bind address`);
  }
  return result;
}

function url(
  value: string | undefined,
  fallback: string,
  name: string,
): string {
  const result = new URL(value?.trim() || fallback);
  const loopback =
    result.hostname === "127.0.0.1" ||
    result.hostname === "localhost" ||
    result.hostname.endsWith(".localhost");
  if (
    (result.protocol !== "https:" &&
      !(result.protocol === "http:" && loopback)) ||
    result.username ||
    result.password ||
    result.search ||
    result.hash
  ) {
    throw new Error(`${name} must be HTTPS or loopback HTTP without extras`);
  }
  return result.href.replace(/\/$/u, "");
}

function privateUrl(
  value: string | undefined,
  fallback: string,
  name: string,
  composeHost: string,
): string {
  const result = new URL(value?.trim() || fallback);
  const loopback =
    result.hostname === "127.0.0.1" ||
    result.hostname === "localhost" ||
    result.hostname.endsWith(".localhost");
  const permittedProtocol =
    result.protocol === "https:" ||
    (result.protocol === "http:" &&
      (loopback || result.hostname === composeHost));
  if (
    !permittedProtocol ||
    result.username ||
    result.password ||
    result.search ||
    result.hash
  ) {
    throw new Error(
      `${name} must be HTTPS, loopback HTTP, or its fixed Compose service`,
    );
  }
  return result.href.replace(/\/$/u, "");
}

function secret(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value || value.length < 32) {
    throw new Error(`${name} must contain at least 32 characters; run setup`);
  }
  return value;
}

function localDataDirectory(value: string | undefined): string {
  const directory = resolve(value ?? ".local/p10-data");
  const local = resolve(".local");
  const below = relative(local, directory);
  if (
    !below ||
    below === ".." ||
    below.startsWith(`..${sep}`) ||
    isAbsolute(below)
  ) {
    throw new Error(
      "P10_DATA_DIR must be inside this project's .local directory",
    );
  }
  return directory;
}

export function prepareDataDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

export function loadConsoleConfig(
  env: NodeJS.ProcessEnv = process.env,
): ConsoleConfig {
  const agentUrls = Object.fromEntries(
    WORKLOADS.map((workload) => [
      workload.id,
      privateUrl(
        env[`${workloadEnvironmentPrefix(workload.id)}_URL`],
        `http://127.0.0.1:${workloadAgentPort(workload.id)}`,
        `${workload.id} URL`,
        workload.id,
      ),
    ]),
  ) as Record<WorkloadId, string>;
  return {
    host: host(env.P10_HOST, "P10_HOST"),
    port: port(env.P10_PORT, 3010, "P10_PORT"),
    baseUrl: url(env.P10_BASE_URL, "http://p10.localhost:3010", "P10_BASE_URL"),
    controlSecret: secret(env, "P10_CONTROL_SECRET"),
    agentUrls,
  };
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const workloadClientIds = Object.fromEntries(
    WORKLOADS.map(({ id }) => {
      const value = env[`${workloadEnvironmentPrefix(id)}_CLIENT_ID`]?.trim();
      return [id, value || `p10-${id}`];
    }),
  ) as Record<WorkloadId, string>;
  if (new Set(Object.values(workloadClientIds)).size !== WORKLOADS.length) {
    throw new Error("P10 workload client IDs must be unique");
  }
  return {
    host: host(env.P10_API_HOST, "P10_API_HOST"),
    port: port(env.P10_API_PORT, 3110, "P10_API_PORT"),
    issuer: url(env.P10_ISSUER, "http://idp.localhost:4000", "P10_ISSUER"),
    apiResource: url(
      env.P10_API_RESOURCE,
      "http://p10.localhost:3010/api",
      "P10_API_RESOURCE",
    ),
    dataDirectory: localDataDirectory(env.P10_DATA_DIR),
    workloadClientIds,
  };
}

export function loadAgentConfig(
  workloadId: WorkloadId,
  env: NodeJS.ProcessEnv = process.env,
): AgentConfig {
  if (!workloadIds.has(workloadId)) throw new Error("Unknown P10 workload");
  const prefix = workloadEnvironmentPrefix(workloadId);
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
  if (!clientId) throw new Error(`${prefix}_CLIENT_ID is required; run setup`);
  return {
    workloadId,
    host: host(env.P10_AGENT_HOST, "P10_AGENT_HOST"),
    port: port(
      env.P10_AGENT_PORT,
      workloadAgentPort(workloadId),
      "P10_AGENT_PORT",
    ),
    controlSecret: secret(env, "P10_CONTROL_SECRET"),
    issuer: url(env.P10_ISSUER, "http://idp.localhost:4000", "P10_ISSUER"),
    apiResource: url(
      env.P10_API_RESOURCE,
      "http://p10.localhost:3010/api",
      "P10_API_RESOURCE",
    ),
    warehouseApiUrl: privateUrl(
      env.P10_WAREHOUSE_API_URL,
      "http://127.0.0.1:3110",
      "P10_WAREHOUSE_API_URL",
      "warehouse-api",
    ),
    clientId,
    clientSecret: secret(env, `${prefix}_CLIENT_SECRET`),
  };
}
