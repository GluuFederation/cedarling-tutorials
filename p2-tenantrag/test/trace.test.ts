import { describe, expect, it, vi } from "vitest";
import { logRetrievalTrace } from "../src/rag/trace.js";

describe("retrieval evidence", () => {
  it("logs one sanitized record", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logRetrievalTrace({
      requestId: "req_test",
      principalId: "mallory",
      candidateCount: 1,
      documentAuthorizationCount: 1,
      loadedChunkCount: 1,
      selectedModel: "vendor/free-model",
    });
    expect(info).toHaveBeenCalledOnce();
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      event: "retrieval.completed",
      requestId: "req_test",
      principalId: "mallory",
      candidateCount: 1,
      documentAuthorizationCount: 1,
      loadedChunkCount: 1,
      selectedModel: "vendor/free-model",
    });
    const serialized = JSON.stringify(info.mock.calls);
    info.mockRestore();
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("protected text");
  });
});
