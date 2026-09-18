import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { loadProjectEnvironment } from "../src/server/environment.js";

describe("loadProjectEnvironment", () => {
  test("loads the project-local environment when it exists", () => {
    const load = vi.fn();
    const expected = resolve("/tutorial/p1-task-manager", ".env");

    expect(
      loadProjectEnvironment("/tutorial/p1-task-manager", {
        exists: (path) => path === expected,
        load,
      }),
    ).toBe(expected);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(expected);
  });

  test("leaves injected environments unchanged when no file exists", () => {
    const load = vi.fn();

    expect(
      loadProjectEnvironment("/app", {
        exists: () => false,
        load,
      }),
    ).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });
});
