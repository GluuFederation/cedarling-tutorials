import { afterEach, expect, it, vi } from "vitest";
import {
  PermissiveAuthorizationGateway,
  capabilityCatalog,
} from "../src/server/capabilities.ts";

afterEach(() => vi.restoreAllMocks());

it("defines exactly the seven locked P11 capability seams", async () => {
  expect(Object.keys(capabilityCatalog)).toEqual([
    "organization.switch",
    "project.read",
    "project.write",
    "invitation.issue",
    "invitation.accept",
    "billing.view",
    "support.open",
  ]);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  const gateway = new PermissiveAuthorizationGateway();
  await gateway.authorize({
    requestId: "request-1",
    principalId: "user-maya",
    capability: "project.read",
    resource: "Project::project-a1",
    facts: { version: 1 },
    effect: "return one project",
  });
  expect(gateway.diagnostic("request-1", "user-maya")).toMatchObject({
    mode: "permissive",
    decision: "ALLOW (FAKE)",
    action: "Workspace::ReadProject",
  });
  expect(gateway.diagnostic("request-1", "user-imani")).toBeUndefined();
});
