import type { MetadataRoute } from "next";

/** PWA manifest (MD-021): installable on Android Chrome. No emblem, no government lettering (D-01). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Margdarshak: your licence, step by step",
    short_name: "Margdarshak",
    description:
      "An independent guide for India's driving-licence journey. Not affiliated with MoRTH, NIC or any State Transport Department.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fcfcfa",
    theme_color: "#fcfcfa",
    lang: "en-IN",
    dir: "ltr",
    categories: ["education", "utilities"],
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
