const acceptedFileTypes = [
  { extension: ".txt", kind: "text", mediaTypes: ["text/plain"] },
  { extension: ".md", kind: "text", mediaTypes: ["text/markdown"] },
  { extension: ".pdf", kind: "binary", mediaTypes: ["application/pdf"] },
  { extension: ".png", kind: "binary", mediaTypes: ["image/png"] },
  { extension: ".jpg", kind: "binary", mediaTypes: ["image/jpeg"] },
  { extension: ".jpeg", kind: "binary", mediaTypes: ["image/jpeg"] },
  { extension: ".webp", kind: "binary", mediaTypes: ["image/webp"] },
  {
    extension: ".mp3",
    kind: "binary",
    mediaTypes: ["audio/mpeg", "audio/mp3"],
  },
  { extension: ".mp4", kind: "binary", mediaTypes: ["video/mp4", "audio/mp4"] },
] as const;

export type AcceptedFileType = (typeof acceptedFileTypes)[number];
export type AcceptedExtension = AcceptedFileType["extension"];

export const acceptedFileInput = acceptedFileTypes
  .map(({ extension }) => extension)
  .join(",");

export function acceptedFileType(
  extension: string,
): AcceptedFileType | undefined {
  return acceptedFileTypes.find(
    (candidate) => candidate.extension === extension,
  );
}
