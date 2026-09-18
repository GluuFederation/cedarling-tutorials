import { describe, expect, it } from "vitest";
import { limits } from "../src/server/config.ts";
import {
  InputError,
  normalizeVirtualName,
  validateContent,
} from "../src/server/validation.ts";

const samples = {
  "file.pdf": Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"),
  "file.png": Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000049454e44ae426082",
    "hex",
  ),
  "file.jpg": Buffer.from(
    "ffd8ffe000104a46494600010100000100010000ffd9",
    "hex",
  ),
  "file.jpeg": Buffer.from(
    "ffd8ffe000104a46494600010100000100010000ffd9",
    "hex",
  ),
  "file.webp": Buffer.from("5249464610000000574542505650382000000000", "hex"),
  "file.mp3": Buffer.from("fffb9064000000000000000000000000", "hex"),
  "file.mp4": Buffer.from(
    "000000186674797069736f6d0000020069736f6d69736f32",
    "hex",
  ),
} as const;

describe("virtual names", () => {
  it("normalizes useful Unicode to NFC", () => {
    expect(normalizeVirtualName("Cafe\u0301 notes (v1).md")).toEqual({
      name: "Café notes (v1).md",
      nameKey: "café notes (v1).md",
    });
  });

  it.each(["", ".", "..", " ../x", "a/b", "a\\b", "x\u0000y", "x\u202Ey"])(
    "rejects ambiguous name %j",
    (name) => expect(() => normalizeVirtualName(name)).toThrow(InputError),
  );
});

describe("content admission", () => {
  it.each(Object.entries(samples))(
    "accepts the signature for %s",
    async (name, bytes) => {
      await expect(validateContent(name, bytes)).resolves.toMatchObject({
        bytes,
      });
    },
  );

  it("accepts strict UTF-8 text and Markdown", async () => {
    await expect(
      validateContent("notes.txt", Buffer.from("Hello")),
    ).resolves.toMatchObject({
      mediaType: "text/plain",
    });
    await expect(
      validateContent("notes.md", Buffer.from("# Hello")),
    ).resolves.toMatchObject({
      mediaType: "text/markdown",
    });
  });

  it("rejects malformed UTF-8 and mismatched signatures", async () => {
    await expect(
      validateContent("bad.txt", Buffer.from([0xc3, 0x28])),
    ).rejects.toMatchObject({ code: "invalid_utf8" });
    await expect(
      validateContent("fake.png", Buffer.from("not a png")),
    ).rejects.toMatchObject({ code: "signature_mismatch" });
  });
  it("rejects content above the file-size bound", async () => {
    await expect(
      validateContent("oversized.txt", Buffer.alloc(limits.fileBytes + 1)),
    ).rejects.toMatchObject({ code: "file_too_large" });
  });
});
