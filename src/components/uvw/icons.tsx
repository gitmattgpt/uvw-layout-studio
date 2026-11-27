import type { ReactNode, SVGProps } from "react";

/**
 * Local icons drawn in the Lucide style (24×24, 2px round stroke).
 * They are used where the installed lucide-react version may not ship the icon yet,
 * so the app builds no matter which lucide-react version is installed.
 */
type IconProps = SVGProps<SVGSVGElement>;

const makeIcon = (children: ReactNode) =>
  function Icon(props: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {children}
      </svg>
    );
  };

/** Auto Unwrap — processor chip with a sparkle. */
export const CpuAi = makeIcon(
  <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M12 8.2l1.1 2.7 2.7 1.1-2.7 1.1-1.1 2.7-1.1-2.7-2.7-1.1 2.7-1.1z" />
    <path d="M9 2v2" />
    <path d="M15 2v2" />
    <path d="M9 20v2" />
    <path d="M15 20v2" />
    <path d="M2 9h2" />
    <path d="M2 15h2" />
    <path d="M20 9h2" />
    <path d="M20 15h2" />
  </>,
);

/** Maintain ratio — ruler with dimension line. */
export const RulerDimensionLine = makeIcon(
  <>
    <path d="M10 15v-3" />
    <path d="M14 15v-3" />
    <path d="M18 15v-3" />
    <path d="M2 8V4" />
    <path d="M22 6H2" />
    <path d="M22 8V4" />
    <path d="M6 15v-3" />
    <rect x="2" y="12" width="20" height="8" rx="2" />
  </>,
);

/** Margin — 2×2 grid with a plus. */
export const Grid2x2Plus = makeIcon(
  <>
    <path d="M12 3v17a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1H3" />
    <path d="M16 19h6" />
    <path d="M19 22v-6" />
  </>,
);

/** Add selection — two united squares. */
export const SquaresUnite = makeIcon(
  <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3a1 1 0 0 0 1 1h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-3a1 1 0 0 0-1-1z" />,
);

/** Remove selection — a square with a dashed square cut out of it. */
export const SquaresSubtract = makeIcon(
  <>
    <rect x="3" y="3" width="13" height="13" rx="2" />
    <path d="M8 21h11a2 2 0 0 0 2-2V8" strokeDasharray="2 3" />
  </>,
);

/** UV background: checkerboard — two offset squares. */
export function CheckerboardIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" stroke="none" aria-hidden="true" {...props}>
      <rect x="3" y="3" width="9" height="9" rx="1.5" />
      <rect x="12" y="12" width="9" height="9" rx="1.5" />
    </svg>
  );
}
