import path from "node:path";
import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { securityHeaders } from "./src/lib/security/headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const isDev = process.env.NODE_ENV !== "production";
const repoRoot = path.join(import.meta.dirname, "..", "..");

const connect = [
  process.env["NEXT_PUBLIC_API_URL"],
  process.env["NEXT_PUBLIC_API_BASE_URL"],
  process.env["NEXT_PUBLIC_WS_BASE_URL"],
].filter((v): v is string => typeof v === "string" && v.length > 0);
// P2 clip media host (Nazar clips, game packs): CSP media-src, img-src and connect-src.
const media = [process.env["NEXT_PUBLIC_MEDIA_HOST"]].filter(
  (v): v is string => typeof v === "string" && v.length > 0,
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The full-stack e2e build (NEXT_PUBLIC_API_URL set) goes to .next-real so it never replaces the
  // mock-mode build that the bundle budget and the mock e2e run read from .next.
  distDir: process.env["NEXT_DIST_DIR"] || ".next",
  // Workspace packages ship TypeScript source; Next compiles them. The P2 packages (game-core,
  // gamification, content) are resolved to their src/*.ts through tsconfig `paths` (their package
  // exports point at an unbuilt dist/ unless the custom "margdarshak-source" condition is set, and
  // Turbopack has no custom-condition option); listing them here keeps any import that bypasses the
  // paths compiled too. Their explicit `.ts` relative imports need allowImportingTsExtensions
  // (tsconfig.json) for tsc; Turbopack and Vite accept them as they are.
  transpilePackages: [
    "@margdarshak/ui",
    "@margdarshak/api-client",
    "@margdarshak/rules",
    "@margdarshak/game-core",
    "@margdarshak/gamification",
    "@margdarshak/content",
  ],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  experimental: {
    optimizePackageImports: ["@heroui/react", "lucide-react"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders({ isDev, connect, media }) },
      // P1 photo and signature fixer (MD-113): the camera is allowed on these two routes only,
      // for this origin; frames stay on the device.
      {
        source: "/:locale(en|hi)/apply/:fixer(photo|signature)",
        headers: [
          {
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()",
          },
        ],
      },
      // Voice guide (MD-313): the microphone is allowed on the home route only, for this origin.
      {
        source: "/:locale(en|hi)",
        headers: [
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()",
          },
        ],
      },
      // Learn and the games: spoken answers to the game coach (API-79) and Nazar commentary
      // (API-74) need the microphone, for this origin only.
      {
        source: "/:locale(en|hi)/learn/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()",
          },
        ],
      },
      // Journey-test lab replica (MD-139): never indexed.
      {
        source: "/:locale(en|hi)/lab/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
      // P2 clip admin, curator and rater screens (plan D4): never indexed.
      {
        source: "/:locale(en|hi)/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
      {
        source: "/serwist/:path*",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default withSerwist(withNextIntl(nextConfig));
