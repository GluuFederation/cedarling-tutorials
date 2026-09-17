export type IconName =
  | "arrow-right"
  | "download"
  | "file"
  | "play"
  | "refresh"
  | "shield-check"
  | "warning";

type IconProps = Readonly<{
  name: IconName;
  size?: number;
}>;

/** Small decorative icon set used by this tutorial UI. */
export function Icon({ name, size = 20 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      {name === "arrow-right" && (
        <>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </>
      )}
      {name === "download" && (
        <>
          <path d="M12 4v11" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 20h14" />
        </>
      )}
      {name === "file" && (
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h6" />
        </>
      )}
      {name === "play" && (
        <path d="m9 7 8 5-8 5z" fill="currentColor" stroke="none" />
      )}
      {name === "refresh" && (
        <>
          <path d="M20 7v5h-5" />
          <path d="M4 17v-5h5" />
          <path d="M6.1 9a7 7 0 0 1 11.6-2L20 9" />
          <path d="M17.9 15A7 7 0 0 1 6.3 17L4 15" />
        </>
      )}
      {name === "shield-check" && (
        <>
          <path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6z" />
          <path d="m9 12 2 2 4-4" />
        </>
      )}
      {name === "warning" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6" />
          <path d="M12 17h.01" />
        </>
      )}
    </svg>
  );
}
