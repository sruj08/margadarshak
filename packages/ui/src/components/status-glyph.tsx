import type { SVGProps } from "react";

/**
 * Status glyphs (DESIGN_SYSTEM §3.5). Shape carries meaning so colour is never alone:
 * done = check in a filled circle, now = amber dot in a ring, later = hollow ring, caution = triangle,
 * danger = octagon (STOP sign), info = circle-i, simulated = dashed diamond.
 * Glyphs are decorative (aria-hidden); the visible word next to them carries the status.
 */
export type StatusKind = "done" | "now" | "later" | "caution" | "danger" | "info" | "simulated";

interface StatusGlyphProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  kind: StatusKind;
  size?: number;
}

export function StatusGlyph({ kind, size = 20, className, ...rest }: StatusGlyphProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
    focusable: false,
    className: className ? `md-glyph md-glyph--${kind} ${className}` : `md-glyph md-glyph--${kind}`,
    ...rest,
  } as const;
  switch (kind) {
    case "done":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path
            d="M7.5 12.5l3 3 6-6.5"
            fill="none"
            stroke="var(--md-on-success)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "now":
      return (
        <svg {...common}>
          <circle
            cx="12"
            cy="12"
            r="9.5"
            fill="none"
            stroke="var(--md-amber-ring)"
            strokeWidth="2"
          />
          <circle cx="12" cy="12" r="5.5" fill="var(--md-amber)" />
        </svg>
      );
    case "later":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "caution":
      return (
        <svg {...common}>
          <path
            d="M12 3.2 22 20.5H2L12 3.2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <path d="M12 9.5v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="17.4" r="1.2" fill="currentColor" />
        </svg>
      );
    case "danger":
      return (
        <svg {...common}>
          <path
            d="M8.2 2.5h7.6l5.7 5.7v7.6l-5.7 5.7H8.2l-5.7-5.7V8.2L8.2 2.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <path d="M12 7.5v5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="16.4" r="1.2" fill="currentColor" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.9" />
          <path d="M12 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="7.6" r="1.2" fill="currentColor" />
        </svg>
      );
    case "simulated":
      return (
        <svg {...common}>
          <path
            d="M12 2.8 21.2 12 12 21.2 2.8 12 12 2.8Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeDasharray="3 2.4"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}
