import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number; weight?: string };

function Glyph({ children, size = 20, weight, ...props }: IconProps) {
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
        {children}
      </g>
    </svg>
  );
}

export const ArrowRight = (props: IconProps) => (
  <Glyph {...props}>
    <path d="m9 18 6-6-6-6" />
  </Glyph>
);
export const WarningCircle = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 17h.01" />
  </Glyph>
);
export const CheckCircle = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </Glyph>
);
export const Shield = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M12 3 5 6v5c0 4.5 3 7.8 7 10 4-2.2 7-5.5 7-10V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </Glyph>
);
export const Folder = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
  </Glyph>
);
export const Users = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.2a3 3 0 0 1 0 5.6M17 14.5a4.5 4.5 0 0 1 3.5 4.5" />
  </Glyph>
);
export const CreditCard = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3 10h18M7 15h3" />
  </Glyph>
);
export const Inbox = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M4 13h4l1.5 2.5h5L16 13h4" />
    <path d="M5.5 5h13l2 8v3.5A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5V13l2-8Z" />
  </Glyph>
);
export const ChevronDown = (props: IconProps) => (
  <Glyph {...props}>
    <path d="m6 9 6 6 6-6" />
  </Glyph>
);
