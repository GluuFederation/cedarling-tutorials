import { describe, expect, it } from "vitest";
import { loadGovernanceCatalog } from "../src/catalog/catalog.js";

describe("GovOps catalog reconciliation", () => {
  it("validates the reviewed ACC and versioned MCP binding", async () => {
    const catalog = await loadGovernanceCatalog("ACC.yaml", "mcp-binding.json");
    expect(catalog.capabilities).toHaveLength(6);
    expect(catalog.bindings).toHaveLength(6);
    expect(
      new Set(catalog.bindings.map(({ kind, name }) => `${kind}:${name}`)).size,
    ).toBe(6);
    expect(
      catalog.bindings.every(({ capabilityId }) =>
        catalog.capabilities.has(capabilityId),
      ),
    ).toBe(true);
  });
});
