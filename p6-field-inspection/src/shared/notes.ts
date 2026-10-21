export const MAX_NOTE_BYTES = 1_000;

export const noteBytes = (notes: string): number =>
  new TextEncoder().encode(notes).byteLength;

export const validNotes = (notes: unknown): notes is string =>
  typeof notes === "string" && noteBytes(notes) <= MAX_NOTE_BYTES;

export const noteLimitMessage =
  "Notes must fit within 1,000 UTF-8 bytes. Shorten the text before saving or sending it.";
