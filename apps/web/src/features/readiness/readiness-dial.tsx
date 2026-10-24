/**
 * ReadinessDial (UI_SPEC_LEARN_GAMES §1.4, §2.7): an SVG arc from 0 to 100 with the advisory 85 mark.
 * `role="img"` with the full sentence as its name; the number and the equation line are real text
 * next to it. Static (no count-up), so reduced motion needs nothing special.
 */
export function ReadinessDial({
  score,
  gate,
  label,
  muted = false,
  size = "lg",
}: {
  score: number;
  gate: number;
  label: string;
  muted?: boolean;
  size?: "sm" | "lg";
}) {
  const r = 80;
  const cx = 100;
  const cy = 100;
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from / 100);
    const a1 = Math.PI * (1 - to / 100);
    const p = (a: number) => `${cx + r * Math.cos(a)} ${cy - r * Math.sin(a)}`;
    return `M${p(a0)} A${r} ${r} 0 0 1 ${p(a1)}`;
  };
  const s = Math.max(0, Math.min(100, score));
  const ga = Math.PI * (1 - gate / 100);
  return (
    <div className="ml-dial" role="img" aria-label={label} data-testid="readiness-dial">
      <svg
        viewBox="0 0 200 116"
        aria-hidden="true"
        style={size === "sm" ? { width: 72 } : undefined}
      >
        <path
          d={arc(0, 100)}
          fill="none"
          stroke="var(--md-surface-3)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {s > 0 ? (
          <path
            d={arc(0, s)}
            fill="none"
            stroke={muted ? "var(--md-ink-3)" : "var(--md-primary)"}
            strokeWidth="14"
            strokeLinecap="round"
          />
        ) : null}
        <line
          x1={cx + (r - 14) * Math.cos(ga)}
          y1={cy - (r - 14) * Math.sin(ga)}
          x2={cx + (r + 12) * Math.cos(ga)}
          y2={cy - (r + 12) * Math.sin(ga)}
          stroke="var(--md-ink)"
          strokeWidth="3"
        />
        <text
          x="100"
          y="98"
          textAnchor="middle"
          fontSize="44"
          fontWeight="600"
          fill="var(--md-ink)"
        >
          {Math.round(s)}
        </text>
      </svg>
    </div>
  );
}
