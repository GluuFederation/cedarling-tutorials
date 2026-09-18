import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number; weight?: string };
type Shape =
  | "left"
  | "right"
  | "refresh"
  | "warning"
  | "download"
  | "file"
  | "folder"
  | "edit"
  | "share"
  | "trash"
  | "upload"
  | "plus"
  | "close";

function Icon({
  shape,
  size = 20,
  weight,
  ...props
}: IconProps & { shape: Shape }) {
  const content = {
    left: <path d="m15 18-6-6 6-6" />,
    right: <path d="m9 18 6-6-6-6" />,
    refresh: (
      <path d="M20 7h-5V2M20 7a8 8 0 0 0-14-2M4 17h5v5M4 17a8 8 0 0 0 14 2" />
    ),
    warning: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 17h.01" />
      </>
    ),
    download: <path d="M12 4v11m-4-4 4 4 4-4M5 20h14" />,
    file: (
      <>
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v5h4" />
      </>
    ),
    folder: <path d="M3 6h7l2 2h9v11H3z" />,
    edit: (
      <>
        <path d="m4 20 4-1 10-10-3-3L5 16z" />
        <path d="m13 8 3 3" />
      </>
    ),
    share: (
      <>
        <circle cx="6" cy="12" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="18" cy="18" r="2" />
        <path d="m8 11 8-4M8 13l8 4" />
      </>
    ),
    trash: (
      <>
        <path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14" />
      </>
    ),
    upload: <path d="M12 20V9m-4 4 4-4 4 4M5 4h14" />,
    plus: (
      <>
        <path d="M3 6h7l2 2h9v11H3z" />
        <path d="M15 11v5M12.5 13.5h5" />
      </>
    ),
    close: <path d="m7 7 10 10M17 7 7 17" />,
  }[shape];
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={weight === "bold" ? 2.5 : 2}
      >
        {content}
      </g>
    </svg>
  );
}

const glyph = (shape: Shape) => (props: IconProps) => (
  <Icon shape={shape} {...props} />
);

export const ArrowLeft = glyph("left");
export const ArrowRight = glyph("right");
export const ArrowsClockwise = glyph("refresh");
export const WarningCircle = glyph("warning");
export const DownloadSimple = glyph("download");
export const File = glyph("file");
export const FileAudio = glyph("file");
export const FileImage = glyph("file");
export const FilePdf = glyph("file");
export const FileText = glyph("file");
export const FileVideo = glyph("file");
export const Folder = glyph("folder");
export const FolderPlus = glyph("plus");
export const PencilSimple = glyph("edit");
export const ShareNetwork = glyph("share");
export const Trash = glyph("trash");
export const UploadSimple = glyph("upload");
export const X = glyph("close");
