import { expect, it } from "vitest";
import { displayTime } from "../app/utils/time.ts";

it("renders explicit UTC deadlines regardless of the source offset", () => {
  expect(displayTime("2026-10-20T07:45:00+01:00")).toBe(
    "20 Oct 2026, 06:45 UTC",
  );
  expect(displayTime("2026-10-20T06:45:00Z")).toBe("20 Oct 2026, 06:45 UTC");
});
