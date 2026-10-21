import { expect, it } from "vitest";
import { noteBytes, validNotes } from "../src/shared/notes.ts";

it("counts UTF-8 bytes consistently for inspection and review notes", () => {
  expect(validNotes("a".repeat(1_000))).toBe(true);
  expect(validNotes("a".repeat(1_001))).toBe(false);
  expect(validNotes("é".repeat(500))).toBe(true);
  expect(validNotes("é".repeat(501))).toBe(false);
  expect(noteBytes("🛠")).toBe(4);
  expect(validNotes("🛠".repeat(250))).toBe(true);
  expect(validNotes("🛠".repeat(251))).toBe(false);
  expect(validNotes(undefined)).toBe(false);
});
