export const MCP_PROTOCOL_VERSION = "2026-07-28" as const;

export type P3Config = Readonly<{
  host: string;
  port: number;
  issuer: string;
  clientId: string;
  mcpResource: string;
  openRouterApiKey?: string;
  openRouterModel: string;
  openRouterAllowPaid: boolean;
  providerTimeoutMs: number;
}>;

function integer(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function openRouterModel(env: NodeJS.ProcessEnv, allowPaid: boolean): string {
  const model = (env.P3_OPENROUTER_MODEL ?? "liquid/lfm-2.5-2.6b:free").trim();
  if (!model || /\s/.test(model)) {
    throw new Error("P3_OPENROUTER_MODEL must be a model ID without spaces");
  }
  if (!allowPaid && model !== "openrouter/free" && !model.endsWith(":free")) {
    throw new Error(
      "P3_OPENROUTER_ALLOW_PAID=true is required for a paid model",
    );
  }
  return model;
}

function allowPaid(env: NodeJS.ProcessEnv): boolean {
  const value = env.P3_OPENROUTER_ALLOW_PAID?.trim() ?? "false";
  if (value !== "true" && value !== "false") {
    throw new Error("P3_OPENROUTER_ALLOW_PAID must be true or false");
  }
  return value === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): P3Config {
  const openRouterAllowPaid = allowPaid(env);
  return {
    host: env.P3_HOST?.trim() || "127.0.0.1",
    port: 17003,
    issuer: "http://localhost:18003",
    clientId: "p3-mcp-capability-governance-cli",
    mcpResource: "http://localhost:17003/mcp",
    ...(env.P3_OPENROUTER_API_KEY?.trim()
      ? { openRouterApiKey: env.P3_OPENROUTER_API_KEY.trim() }
      : {}),
    openRouterModel: openRouterModel(env, openRouterAllowPaid),
    openRouterAllowPaid,
    providerTimeoutMs: integer(
      env.P3_PROVIDER_TIMEOUT_MS,
      15_000,
      "P3_PROVIDER_TIMEOUT_MS",
      1_000,
      60_000,
    ),
  };
}
