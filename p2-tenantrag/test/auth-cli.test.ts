import { describe, expect, it, vi } from "vitest";
import { authPersonaArgument, runAuthCli } from "../src/auth/cli.js";
import type { P2Config } from "../src/config/project-config.js";
import type { DeviceVerification } from "../src/auth/device-flow.js";

const config = {
  issuer: "http://idp.localhost:4000",
  clientId: "p2-tenantrag-cli",
  apiResource: "http://p2.localhost:3000/api",
} as P2Config;

describe("P2 auth CLI", () => {
  it("accepts the separator forwarded by the documented pnpm command", () => {
    expect(authPersonaArgument(["--", "ada"])).toBe("ada");
    expect(authPersonaArgument(["ada", "leo"])).toBeUndefined();
  });

  it("prints instructions to stderr and the token once to stdout", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const authorize = vi.fn(
      async (options: {
        onVerification: (verification: DeviceVerification) => void;
      }) => {
        options.onVerification({
          userCode: "ABCD-EFGH",
          verificationUri: "http://idp.localhost:4000/device",
          verificationUriComplete:
            "http://idp.localhost:4000/device?user_code=ABCD-EFGH",
        });
        return "short-lived-access-token";
      },
    );
    await runAuthCli("mallory", config, { authorize, stdout, stderr });
    expect(stdout).toHaveBeenCalledExactlyOnceWith(
      "short-lived-access-token\n",
    );
    expect(stderr).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(
      "short-lived-access-token",
    );
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ persona: "mallory" }),
    );
  });
});
