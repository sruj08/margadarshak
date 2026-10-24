import { DM_Mono, Figtree, Fraunces, Mukta, Tiro_Devanagari_Hindi } from "next/font/google";

/**
 * Fonts (DESIGN_SYSTEM §4, MD-019). next/font self-hosts every file, so no request leaves our origin.
 * Only Figtree (Latin UI) preloads; Devanagari, display and numeric faces load on first use with
 * `swap`, which keeps the first-load font payload small on 2G. tokens.css builds every stack from
 * these CSS variables.
 */
export const figtree = Figtree({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-figtree",
  display: "swap",
});

export const mukta = Mukta({
  subsets: ["devanagari", "latin"],
  weight: ["400", "600", "700"],
  variable: "--font-mukta",
  display: "swap",
  preload: false,
});

export const fraunces = Fraunces({
  subsets: ["latin"],
  weight: "variable",
  axes: ["SOFT", "opsz"],
  variable: "--font-fraunces",
  display: "swap",
  preload: false,
});

export const tiroDevanagari = Tiro_Devanagari_Hindi({
  subsets: ["devanagari"],
  weight: "400",
  variable: "--font-tiro-devanagari",
  display: "optional",
  preload: false,
});

export const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-dm-mono",
  display: "swap",
  preload: false,
});

export const fontVariables = [
  figtree.variable,
  mukta.variable,
  fraunces.variable,
  tiroDevanagari.variable,
  dmMono.variable,
].join(" ");
