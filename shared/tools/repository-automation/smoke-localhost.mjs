// Checks each running project's public issuer, signing keys, and application endpoint.
import assert from "node:assert/strict";
import { tutorialProjects } from "./changed-projects.mjs";

const selected = process.argv.slice(2);
assert(selected.length, "Provide at least one project directory");
for (const project of selected) {
  assert(tutorialProjects.includes(project), "Unknown tutorial project");
  const number = Number(project.match(/^p(\d+)-/)[1]);
  const issuer = `http://localhost:${18000 + number}`;
  const get = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    assert(response.ok, `${url}: HTTP ${response.status}`);
    return response.json();
  };
  const discovery = await get(`${issuer}/.well-known/openid-configuration`);
  assert.equal(discovery.issuer, issuer);
  assert.equal(new URL(discovery.jwks_uri).origin, issuer);
  const jwks = await get(discovery.jwks_uri);
  assert(jwks.keys.some((key) => key.kty === "RSA" && !key.d));
  // P2's application startup requires real Voyage/OpenRouter credentials.
  if (number !== 2) {
    await get(`http://localhost:${17000 + number}/${[6, 7, 10, 14].includes(number) ? "healthz" : "health"}`);
  }
  if (number === 10) {
    // Reading the workspace exercises agent credentials, token issuance, and API verification.
    const workspace = await get("http://localhost:17010/api/workspace");
    assert(Array.isArray(workspace.inventory) && Array.isArray(workspace.transfers));
  }
  console.info(`${project}: localhost issuer${number === 2 ? "" : " and application"} ready`);
}
