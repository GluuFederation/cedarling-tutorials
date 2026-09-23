import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
  weight?: "bold";
};

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

export const ArrowLeft = (props: IconProps) => (
  <Glyph {...props}>
    <path d="m15 18-6-6 6-6" />
  </Glyph>
);
export const ArrowRight = (props: IconProps) => (
  <Glyph {...props}>
    <path d="m9 18 6-6-6-6" />
  </Glyph>
);
export const CheckCircle = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </Glyph>
);
export const Plus = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M12 5v14M5 12h14" />
  </Glyph>
);
export const WarningCircle = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 17h.01" />
  </Glyph>
);
export const X = (props: IconProps) => (
  <Glyph {...props}>
    <path d="m7 7 10 10M17 7 7 17" />
  </Glyph>
);
