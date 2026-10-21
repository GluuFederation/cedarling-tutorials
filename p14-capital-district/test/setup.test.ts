import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { setupProject } from "../scripts/setup.ts";
import { AuthStore } from "../src/server/auth/auth-store.ts";
import { loadConfig } from "../src/server/config/environment.ts";
import { GameStore } from "../src/server/data/game-store.ts";
import { GameService } from "../src/server/game/service.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function temporaryRoot() {
  mkdirSync(".local", { recursive: true });
  const root = mkdtempSync(resolve(".local/setup-test-"));
  roots.push(root);
  return root;
}

describe("P14 setup", () => {
  it.each([17014, 4214])(
    "synchronizes registered ports and preserves matches, sessions and private credentials (%s)",
    async (port) => {
      const root = temporaryRoot();
      const identity = resolve(root, "identity.env");
      writeFileSync(
        identity,
        [
          "IDP_PROJECT=P14",
          "IDP_ISSUER=http://localhost:4400",
          "P14_CLIENT_ID=p14-test-client",
          "P14_CLIENT_SECRET=test-secret-with-at-least-thirty-two-characters",
          `P14_API_RESOURCE=http://localhost:${port}/api`,
          `P14_REDIRECT_URI=http://localhost:${port}/auth/callback`,
          `P14_POST_LOGOUT_REDIRECT_URI=http://localhost:${port}`,
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
      writeFileSync(
        resolve(root, ".env"),
        "P14_PORT=3000\nP14_BASE_URL=http://localhost:3000\nP14_LOCAL_NOTE=keep\n",
        { mode: 0o600 },
      );
      setupProject(root, identity);
      const first = readFileSync(resolve(root, ".env"), "utf8");
      const environment = parseEnv(first);
      const config = loadConfig(environment, root);
      expect(environment).toMatchObject({
        P14_PORT: String(port),
        P14_LOCAL_NOTE: "keep",
        P14_CLIENT_ID: "p14-test-client",
      });
      const game = new GameStore(resolve(config.dataDirectory, "game.sqlite"));
      const { match } = await new GameService(game).create(
        { id: "dina", name: "Dina" },
        { name: "Keep this match", preset: "normal" },
        "setup-test-key",
      );
      game.close();
      const auth = new AuthStore(
        resolve(config.dataDirectory, "auth.sqlite"),
        config,
      );
      const session = auth.createSession(
        "dina",
        "private-token",
        Date.now() + 60_000,
      );
      auth.close();
      setupProject(root, identity);
      expect(readFileSync(resolve(root, ".env"), "utf8")).toBe(first);
      const afterGame = new GameStore(
        resolve(config.dataDirectory, "game.sqlite"),
      );
      expect(afterGame.get(match.id)?.name).toBe("Keep this match");
      afterGame.close();
      const afterAuth = new AuthStore(
        resolve(config.dataDirectory, "auth.sqlite"),
        config,
      );
      expect(afterAuth.getSession(session.id)?.user.id).toBe("dina");
      afterAuth.close();
      if (process.platform !== "win32")
        expect(statSync(resolve(root, ".env")).mode & 0o777).toBe(0o600);
    },
  );
  it("refuses unexpected redirect paths before writing app configuration", () => {
    const root = temporaryRoot();
    const identity = resolve(root, "identity.env");
    writeFileSync(
      identity,
      "P14_REDIRECT_URI=http://localhost:17014/elsewhere\n",
      { mode: 0o600 },
    );
    expect(() => setupProject(root, identity)).toThrow("redirect URI");
  });
  it("refuses symlinked configuration and application data", () => {
    const root = temporaryRoot();
    symlinkSync(resolve(root, "missing"), resolve(root, ".env"));
    expect(() => setupProject(root, resolve(root, "identity.env"))).toThrow(
      "regular file",
    );
    rmSync(resolve(root, ".env"));
    mkdirSync(resolve(root, ".local"));
    symlinkSync(resolve(root, "elsewhere"), resolve(root, ".local/p14-data"));
    expect(() => setupProject(root, resolve(root, "identity.env"))).toThrow(
      "symlinks",
    );
  });
});
