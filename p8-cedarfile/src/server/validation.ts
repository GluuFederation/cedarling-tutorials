import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { limits } from "./config.ts";
import {
  acceptedFileType,
  type AcceptedExtension,
} from "../shared/file-types.ts";

export type AcceptedContent = Readonly<{
  extension: AcceptedExtension;
  mediaType: string;
  bytes: Buffer;
}>;

export class InputError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}

const bidirectionalFormatting = /[\u202A-\u202E\u2066-\u2069]/u;
const controlCharacter = /\p{Cc}/u;
export const resourceIdPattern = /^res_[A-Za-z0-9_-]{12,64}$/;

export function normalizeVirtualName(input: string): {
  name: string;
  nameKey: string;
} {
  const name = input.normalize("NFC");
  const bytes = Buffer.byteLength(name, "utf8");
  if (!name || bytes > limits.nameBytes) throw new InputError("invalid_name");
  if (name.trim() !== name || name === "." || name === "..") {
    throw new InputError("invalid_name");
  }
  if (
    name.includes("/") ||
    name.includes("\\") ||
    controlCharacter.test(name) ||
    bidirectionalFormatting.test(name)
  ) {
    throw new InputError("invalid_name");
  }
  return { name, nameKey: name.toLowerCase() };
}

export function parseResourceId(value: string): string {
  if (!resourceIdPattern.test(value)) {
    throw new InputError("resource_not_found");
  }
  return value;
}

export async function validateContent(
  name: string,
  input: Uint8Array,
): Promise<AcceptedContent> {
  if (input.byteLength > limits.fileBytes) {
    throw new InputError("file_too_large");
  }
  const extension = path.extname(name).toLowerCase();
  const bytes = Buffer.from(input);
  const fileType = acceptedFileType(extension);
  if (!fileType) throw new InputError("unsupported_file_type");
  if (fileType.kind === "text") {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new InputError("invalid_utf8");
    }
    return {
      extension: fileType.extension,
      mediaType: fileType.mediaTypes[0],
      bytes,
    };
  }
  const detected = await fileTypeFromBuffer(bytes);
  if (
    !detected ||
    !fileType.mediaTypes.some((type) => type === detected.mime)
  ) {
    throw new InputError("signature_mismatch");
  }
  return {
    extension: fileType.extension,
    mediaType: detected.mime,
    bytes,
  };
}

export function contentDisposition(name: string, download: boolean): string {
  const fallback = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${download ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
