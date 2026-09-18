import { expect, it } from "vitest";
import { createAgentApp } from "../src/server/agent-app.ts";

it("returns a stable request ID for unsupported agent routes", async () => {
  const app = await createAgentApp(
    {
      workloadId: "transfer-planner",
      host: "127.0.0.1",
      port: 3111,
      controlSecret: "control-secret-that-is-at-least-32-characters",
      issuer: "http://idp.localhost:4000",
      apiResource: "http://p10.localhost:3010/api",
      warehouseApiUrl: "http://127.0.0.1:3110",
      clientId: "p10-transfer-planner",
      clientSecret: "client-secret-that-is-at-least-32-characters",
    },
    { accessToken: async () => "unused" },
  );
  const response = await app.inject({ method: "GET", url: "/missing" });
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({
    error: "not_found",
    requestId: expect.any(String),
  });
  await app.close();
});
