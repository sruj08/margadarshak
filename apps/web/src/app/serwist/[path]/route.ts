import { createSerwistRoute } from "@serwist/turbopack";

/**
 * Serves the Serwist service worker (built from src/app/sw.ts by esbuild) at /serwist/sw.js with
 * `Service-Worker-Allowed: /`, so it controls the whole origin. The offline pages are precached in
 * both locales so a reload without network shows the shell and the offline state (MD-021).
 */
const revision = process.env["NEXT_PUBLIC_BUILD_ID"] ?? `${Date.now()}`;

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
    // The brand .webp files are raster masters for slides and sharing; the app uses the SVGs.
    globIgnores: ["**/node_modules/**/*", "public/brand/*.webp"],
    additionalPrecacheEntries: [
      { url: "/en/offline", revision },
      { url: "/hi/offline", revision },
      { url: "/manifest.webmanifest", revision },
    ],
  },
);
