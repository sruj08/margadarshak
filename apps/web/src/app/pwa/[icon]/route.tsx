import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * App icons rendered at build time (static PNGs): the Seeing Wheel symbol (public/brand, dark
 * colourway) on a road-slate square. No emblem, tricolour or government lettering (D-01).
 *
 * `art` is the symbol file's share of the icon edge. Its ink spans 79% x 83% of the file, so 0.72
 * keeps every corner inside the maskable 80% safe circle; iOS only rounds corners, so it gets more.
 */
const ICONS = {
  "icon-192.png": { size: 192, maskable: false, art: 0.92 },
  "icon-512.png": { size: 512, maskable: false, art: 0.92 },
  "maskable-512.png": { size: 512, maskable: true, art: 0.72 },
  "apple-touch-icon.png": { size: 180, maskable: true, art: 0.86 },
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

let symbol: Promise<string> | undefined;

function symbolDataUri(): Promise<string> {
  symbol ??= readFile(join(process.cwd(), "public/brand/margdarshak-mark-dark.svg")).then(
    (svg) => `data:image/svg+xml;base64,${svg.toString("base64")}`,
  );
  return symbol;
}

export async function GET(_req: Request, { params }: { params: Promise<{ icon: string }> }) {
  const { icon } = await params;
  if (!isIconName(icon)) return new Response("Not found", { status: 404 });
  const { size, maskable, art } = ICONS[icon];
  const src = await symbolDataUri();
  const artSize = Math.round(size * art);
  return new ImageResponse(
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundImage: "linear-gradient(160deg, #2a2c33 0%, #16171c 100%)",
        borderRadius: maskable ? 0 : Math.round(size * 0.22),
      }}
    >
      <img src={src} width={artSize} height={artSize} alt="" />
    </div>,
    { width: size, height: size },
  );
}
