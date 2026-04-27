import type { JSX } from "react";

interface LogoProps {
  /** Square render size in px. */
  size?: number;
  className?: string;
}

/**
 * Shyre brand mark: an S-shaped path winding past two hills — a quiet
 * nod to the name's "Shire" rhyme. Uses `currentColor` so the caller
 * controls the brand color via Tailwind text utilities (typically
 * `text-accent`). The hills sit behind at low opacity so the S reads
 * cleanly at favicon size; at hero size the landscape comes through.
 *
 * The favicon at `src/app/icon.svg` mirrors this geometry with a
 * hardcoded indigo so it renders without a stylesheet.
 */
export function Logo({ size = 32, className }: LogoProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M 0 28 Q 8 18, 16 28 Q 24 18, 32 28 Z"
        fill="currentColor"
        opacity="0.25"
      />
      <path
        d="M 24 6 Q 14 12, 16 18 Q 18 24, 8 28"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
