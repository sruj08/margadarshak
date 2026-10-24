const SPOKES = Array.from({ length: 24 }, (_, i) => i * 15);

/**
 * Ashoka Chakra as a quiet watermark behind the home headline. One flat, single-colour SVG
 * (24 spokes, rim, hub): it is decoration only, so it stays small and very low opacity and never
 * competes with the text above it (opacity and position live in `.md-chakra`).
 */
export function AshokaChakra() {
  return (
    <div className="md-chakra" aria-hidden="true">
      <svg
        viewBox="-100 -100 200 200"
        className="md-chakra__svg"
        focusable="false"
        aria-hidden="true"
      >
        <g fill="none" stroke="currentColor">
          <circle r="92" strokeWidth="3" />
          <circle r="80" strokeWidth="9" />
          <circle r="22" strokeWidth="4" />
        </g>
        <g fill="currentColor">
          {SPOKES.map((deg) => (
            <g key={deg} transform={`rotate(${deg})`}>
              <polygon points="0,-22 -3.4,-48 0,-72 3.4,-48" />
              <circle cx="0" cy="-75" r="3" transform="rotate(7.5)" />
            </g>
          ))}
          <circle r="9" />
        </g>
      </svg>
    </div>
  );
}
