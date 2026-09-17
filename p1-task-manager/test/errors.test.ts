import { describe, expect, it } from "vitest";
import { ApiError } from "../src/web/api";
import { friendlyError } from "../src/web/errors";

describe("P1 failure messages", () => {
  it.each([
    [new ApiError(401, "authentication_required"), "Session expired"],
    [new ApiError(400, "invalid_task"), "Check the task fields"],
    [new ApiError(404, "task_not_found"), "Task unavailable"],
    [new ApiError(409, "stale_task_version"), "Task changed"],
    [new Error("ECONNREFUSED"), "Task service unavailable"],
  ])(
    "differentiates %# without exposing internal errors",
    (error, expected) => {
      const message = friendlyError(error);
      expect(message).toContain(expected);
      expect(message).not.toContain("ECONNREFUSED");
    },
  );
});
