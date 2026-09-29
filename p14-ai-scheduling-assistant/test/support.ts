import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Config } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";

export function testConfig(directory: string): Config {
  return {
    host: "127.0.0.1",
    port: 17014,
    baseUrl: "http://localhost:17014",
    issuer: "http://localhost:18014",
    apiResource: "http://localhost:17014/api",
    clientId: "p14-ai-scheduling-assistant",
    clientSecret: "s".repeat(32),
    sessionEncryptionKey: Buffer.alloc(32, 1),
    dataDirectory: directory,
  };
}

export function testDatabase(): {
  database: AppDatabase;
  cleanup: () => void;
  config: Config;
} {
  const directory = mkdtempSync(resolve(tmpdir(), "p14-test-"));
  const config = testConfig(directory);
  const database = new AppDatabase(resolve(directory, "test.sqlite"), config);
  return {
    database,
    config,
    cleanup: () => {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
