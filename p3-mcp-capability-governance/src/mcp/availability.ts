export async function requireMcpServer(
  endpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const origin = new URL(endpoint).origin;
  let response: Response;
  try {
    response = await fetcher(`${origin}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_000),
    });
  } catch {
    throw new Error(
      `P3 MCP server is unavailable at ${origin}. Start it with pnpm dev, then retry pnpm chat.`,
    );
  }
  const expectedType = response.headers
    .get("content-type")
    ?.startsWith("application/json");
  let body: { status?: unknown; service?: unknown } | undefined;
  try {
    body = expectedType
      ? ((await response.json()) as { status?: unknown })
      : undefined;
  } catch {
    body = undefined;
  }
  if (
    !response.ok ||
    body?.status !== "ok" ||
    body.service !== "p3-mcp-capability-governance"
  ) {
    throw new Error(
      `${origin} does not expose the expected P3 health endpoint. Stop the incompatible listener or configure a free P3 port.`,
    );
  }
}
