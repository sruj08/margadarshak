import type { BankVisual } from "../content/bank-types";

/**
 * A road sign or hand-signal picture on a question (CURRICULUM §2, GAME_DESIGN §11.9). The sign
 * vectors are still being drawn (`signs.json` asset status "to_draw"), so this renders the sign's
 * outline shape and colour family plus the authored description. The description says the shape and
 * the symbol, never the meaning, so it never gives the answer away.
 */

const RED = "#C8102E";
const BLUE = "#1F4FA3";

function Shape({ v }: { v: BankVisual }) {
  const s = v.scheme;
  switch (v.shape) {
    case "octagon":
      return (
        <g>
          <path d="M37 8h46l29 29v46l-29 29H37L8 83V37Z" fill={RED} stroke="#fff" strokeWidth="4" />
          <text x="60" y="68" textAnchor="middle" fontSize="22" fontWeight="700" fill="#fff">
            STOP
          </text>
        </g>
      );
    case "inverted_triangle":
      return (
        <path
          d="M10 14h100L60 106Z"
          fill="#fff"
          stroke={RED}
          strokeWidth="10"
          strokeLinejoin="round"
        />
      );
    case "triangle":
      return (
        <path
          d="M60 12l50 92H10Z"
          fill="#fff"
          stroke={RED}
          strokeWidth="10"
          strokeLinejoin="round"
        />
      );
    case "circle":
      if (s.startsWith("blue")) return <circle cx="60" cy="60" r="50" fill={BLUE} />;
      if (s === "red_disc_white_bar")
        return (
          <g>
            <circle cx="60" cy="60" r="50" fill={RED} />
            <rect x="24" y="52" width="72" height="16" fill="#fff" />
          </g>
        );
      return <circle cx="60" cy="60" r="46" fill="#fff" stroke={RED} strokeWidth="10" />;
    case "rectangle":
      return (
        <g>
          <rect x="16" y="10" width="88" height="100" rx="8" fill={BLUE} />
          <rect x="30" y="26" width="60" height="56" rx="4" fill="#fff" />
        </g>
      );
    case "road_marking":
      return (
        <g>
          <rect x="6" y="20" width="108" height="80" rx="6" fill="#4A4D55" />
          <path d="M60 28v14M60 52v14M60 76v14" stroke="#fff" strokeWidth="6" />
        </g>
      );
    case "signal_head":
      return (
        <g>
          <rect x="38" y="6" width="44" height="108" rx="10" fill="#2A2C33" />
          <circle cx="60" cy="28" r="11" fill="#5A5D66" />
          <circle cx="60" cy="60" r="11" fill="#5A5D66" />
          <circle cx="60" cy="92" r="11" fill="#5A5D66" />
        </g>
      );
    default:
      return (
        <g>
          <rect
            x="10"
            y="20"
            width="100"
            height="80"
            rx="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
          />
          <circle cx="60" cy="48" r="12" fill="currentColor" />
          <path d="M40 92c4-18 36-18 40 0" fill="none" stroke="currentColor" strokeWidth="4" />
        </g>
      );
  }
}

export function SignVisual({ visual, label }: { visual: BankVisual; label?: string }) {
  return (
    <figure
      className="ml-sign"
      role="img"
      aria-label={label ? `${label}: ${visual.alt}` : visual.alt}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <Shape v={visual} />
      </svg>
      <figcaption aria-hidden="true">{visual.alt}</figcaption>
    </figure>
  );
}
