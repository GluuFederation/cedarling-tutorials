import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { loadTutorialEnvironment } from "../src/environment.js";

describe("loadTutorialEnvironment", () => {
  test("loads only the provider-local environment", () => {
    const load = vi.fn();
    const expected = resolve("/tutorial/shared/identity-provider", ".env");

    expect(
      loadTutorialEnvironment("/tutorial/shared/identity-provider", {
        exists: (path) => path === expected,
        load,
      }),
    ).toBe(expected);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(expected);
  });

  test("does not search another project's environment", () => {
    const load = vi.fn();

    expect(
      loadTutorialEnvironment("/tutorial/shared/identity-provider", {
        exists: () => false,
        load,
      }),
    ).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });
});
