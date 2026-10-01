import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, expect, it } from "vitest";
import { buildPolicyStore } from "../../shared/policy-store.mjs";

const dependencyRoot = fileURLToPath(new URL("..", import.meta.url));
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), "p3-policy-"));
  directories.push(projectRoot);
  await cp(
    join(dependencyRoot, "policy-store"),
    join(projectRoot, "policy-store"),
    { recursive: true },
  );
  const issuerPath = join(
    projectRoot,
    "policy-store/trusted-issuers/tutorial-idp.json",
  );
  return { projectRoot, issuerPath };
}

it.each(["configuration_endpoint", "openid_configuration_endpoint"])(
  "packages %s unchanged and reproducibly",
  async (field) => {
    const { projectRoot, issuerPath } = await fixture();
    const issuer = JSON.parse(await readFile(issuerPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete issuer.configuration_endpoint;
    issuer[field] = "http://localhost:18003/.well-known/openid-configuration";
    await writeFile(issuerPath, JSON.stringify(issuer));
    const first = await buildPolicyStore({ projectRoot, dependencyRoot });
    const second = await buildPolicyStore({ projectRoot, dependencyRoot });
    expect(first.sha256).toBe(second.sha256);
    const entries = unzipSync(await readFile(first.outputPath));
    expect(Object.keys(entries).sort()).toEqual([
      "metadata.json",
      "policies/incident-operations.cedar",
      "schema.cedarschema",
      "trusted-issuers/tutorial-idp.json",
    ]);
    expect(
      JSON.parse(strFromU8(entries["trusted-issuers/tutorial-idp.json"]!)),
    ).toEqual(issuer);
  },
);

it("rejects ambiguous issuer discovery configuration", async () => {
  const { projectRoot, issuerPath } = await fixture();
  const issuer = JSON.parse(await readFile(issuerPath, "utf8")) as Record<
    string,
    unknown
  >;
  issuer.openid_configuration_endpoint =
    "http://another-issuer/.well-known/openid-configuration";
  await writeFile(issuerPath, JSON.stringify(issuer));
  await expect(
    buildPolicyStore({ projectRoot, dependencyRoot }),
  ).rejects.toThrow("exactly one discovery endpoint");
});
