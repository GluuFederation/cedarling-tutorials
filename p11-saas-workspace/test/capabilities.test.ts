import { afterEach, expect, it, vi } from "vitest";
import {
  capabilityCatalog,
  PermissiveAuthorizationGateway,
} from "../server/workspace/capabilities.ts";

afterEach(() => vi.restoreAllMocks());

it("keeps all eight capabilities permissive and logs only the request summary", async () => {
  expect(capabilityCatalog).toEqual({
    "organization.switch": "Workspace::SwitchOrganization",
    "members.read": "Workspace::ReadMembers",
    "project.read": "Workspace::ReadProject",
    "project.write": "Workspace::WriteProject",
    "invitation.issue": "Workspace::IssueInvitation",
    "invitation.accept": "Workspace::AcceptInvitation",
    "billing.view": "Workspace::ViewBilling",
    "support.open": "Workspace::OpenSupportScope",
  });
  const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const gateway = new PermissiveAuthorizationGateway();
  for (const capability of Object.keys(
    capabilityCatalog,
  ) as (keyof typeof capabilityCatalog)[]) {
    await gateway.authorize({
      requestId: "request-1",
      principalId: "user-maya",
      capability,
      resource: "Organization::aster",
      facts: { currentMembership: false, privateValue: "unlogged-fact" },
      effect: "exercise the baseline",
    });
    expect(log).toHaveBeenLastCalledWith(
      `P11 server | FAKE ALLOW | ${capability} | user-maya -> Organization::aster | request-1`,
    );
  }
  expect(log).toHaveBeenCalledTimes(8);
  expect(JSON.stringify(log.mock.calls)).not.toContain("unlogged-fact");
});
