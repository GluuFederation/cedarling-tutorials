import { describe, expect, test } from "vitest";
import { requireGrantedScope } from "../src/server/oidc.ts";

describe("OIDC scope boundary", () => {
  test("rejects an initial token response without data.access", () => {
    expect(() => requireGrantedScope("openid profile email")).toThrow(
      "The token response did not grant data.access",
    );
    expect(() => requireGrantedScope(undefined)).toThrow(
      "The token response did not grant data.access",
    );
  });

  test("retains the previous grant when refresh omits scope", () => {
    const previous = "openid profile email data.access";
    expect(requireGrantedScope(undefined, previous)).toBe(previous);
  });

  test("rejects a refresh response that explicitly drops data.access", () => {
    expect(() =>
      requireGrantedScope(
        "openid profile email",
        "openid profile email data.access",
      ),
    ).toThrow("The token response did not grant data.access");
  });
});
