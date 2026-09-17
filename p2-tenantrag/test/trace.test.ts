import { describe, expect, it, vi } from "vitest";
import { logPermissiveTrace } from "../src/rag/trace.js";

describe("permissive server evidence", () => {
  it("logs one sanitized line", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logPermissiveTrace({
      requestId: "req_test",
      principalId: "mallory",
      candidates: [{ documentId: "a-public", chunkId: "a-public-1" }],
      documentAuthorizationCount: 1,
      loadedChunkCount: 1,
      selectedModel: "vendor/free-model",
      timings: {
        queryEmbeddingMs: 1,
        searchMs: 2,
        metadataMs: 3,
        generationMs: 4,
        totalMs: 10,
      },
    });
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0]?.[0]).toContain("P2 server | FAKE ALLOW");
    expect(info.mock.calls[0]?.[0]).not.toContain("\n");
    const serialized = JSON.stringify(info.mock.calls);
    info.mockRestore();
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("protected text");
  });
});
