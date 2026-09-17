import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number; weight?: string };

export function ArrowRight({ size = 20, weight, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      <path
        d="m9 18 6-6-6-6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={weight === "bold" ? 2.5 : 2}
      />
    </svg>
  );
}

export function ArrowLeft({ size = 20, weight, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      <path
        d="m15 18-6-6 6-6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={weight === "bold" ? 2.5 : 2}
      />
    </svg>
  );
}
