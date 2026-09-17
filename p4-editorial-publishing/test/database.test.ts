import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentDigest,
  decryptJson,
  encryptJson,
} from "../src/server/crypto.ts";
import { AppDatabase, resetDatabase } from "../src/server/database.ts";
import { fixture } from "./support.ts";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe("editorial persistence", () => {
  it("seeds a bounded Tenant A queue and stable normalized digest", () => {
    const opened = fixture();
    cleanup = opened.cleanup;
    expect(opened.database.listArticles("tenant-a")).toHaveLength(4);
    expect(contentDigest("Cafe\u0301", "Body")).toBe(
      contentDigest("Café", "Body"),
    );
  });

  it("encrypts server-held token material", () => {
    const encrypted = encryptJson({ accessToken: "secret" }, "x".repeat(32));
    expect(encrypted).not.toContain("secret");
    expect(decryptJson(encrypted, "x".repeat(32))).toEqual({
      accessToken: "secret",
    });
  });

  it("resets only P4 database files and restores fixtures", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "p4-reset-test-"));
    const sentinel = resolve(directory, "keep.txt");
    writeFileSync(sentinel, "keep");
    try {
      new AppDatabase(directory, "http://idp.localhost:4000").close();
      resetDatabase(directory, "http://idp.localhost:4000");
      const database = new AppDatabase(directory, "http://idp.localhost:4000");
      expect(database.listArticles("tenant-a")).toHaveLength(4);
      database.close();
      expect(existsSync(sentinel)).toBe(true);
      expect(readFileSync(sentinel, "utf8")).toBe("keep");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
