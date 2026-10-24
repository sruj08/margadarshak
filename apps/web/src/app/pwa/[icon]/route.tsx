import { ImageResponse } from "next/og";

/**
 * App icons rendered at build time (static PNGs): a rounded road-slate square with a dawn arc rising
 * over a two-lane road (DESIGN_SYSTEM §2). No emblem, tricolour or government lettering (D-01).
 */
const ICONS = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "maskable-512.png": { size: 512, maskable: true },
  "apple-touch-icon.png": { size: 180, maskable: true },
} as const;

type IconName = keyof typeof ICONS;

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ICONS).map((icon) => ({ icon }));
}

function isIconName(name: string): name is IconName {
  return name in ICONS;
}

export async function GET(_req: Request, { params }: { params: Promise<{ icon: string }> }) {
  const { icon } = await params;
  if (!isIconName(icon)) return new Response("Not found", { status: 404 });
  const { size, maskable } = ICONS[icon];
  // Maskable icons keep the artwork inside the central 80% safe zone and fill the whole square.
  const inset = maskable ? Math.round(size * 0.14) : 0;
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const art = size - inset * 2;
  return new ImageResponse(
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#2a2c33",
        borderRadius: radius,
      }}
    >
      <svg width={art} height={art} viewBox="0 0 100 100" aria-hidden="true">
        <title>Margdarshak</title>
        <defs>
          <linearGradient id="dawn" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#f9730c" />
            <stop offset="0.5" stopColor="#feb12b" />
            <stop offset="1" stopColor="#a5bbfc" />
          </linearGradient>
        </defs>
        <path
          d="M18 56 A32 32 0 0 1 82 56"
          fill="none"
          stroke="url(#dawn)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <circle cx="50" cy="44" r="9" fill="#feb12b" />
        <path d="M44 60 H56 L76 92 H24 Z" fill="#1e2026" />
        <path
          d="M49 63 h2 l0.6 7 h-3.2z M48.2 75 h3.6 l0.9 9 h-5.4z"
          fill="#ffffff"
          opacity="0.85"
        />
      </svg>
    </div>,
    { width: size, height: size },
  );
}
