/**
 * Display preferences, stored on this device only (no account, no PII). Applied to <html> as the
 * data attributes tokens.css understands. public/theme-init.js applies the same values before first
 * paint; keep the key and attribute names in sync with that file.
 */

export const PREFS_KEY = "md.prefs";

export type ThemePref = "system" | "light" | "dark";

export interface Prefs {
  theme: ThemePref;
  /** In-app high contrast (data-contrast="more"); the OS setting applies on its own. */
  contrast: boolean;
  /** In-app reduced motion (data-motion="reduced"); the OS setting applies on its own. */
  reducedMotion: boolean;
}

export const DEFAULT_PREFS: Prefs = { theme: "light", contrast: false, reducedMotion: false };

export function parsePrefs(raw: string | null | undefined): Prefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return DEFAULT_PREFS;
    const o = v as Record<string, unknown>;
    const theme = o["theme"];
    return {
      theme: theme === "light" || theme === "dark" || theme === "system" ? theme : "light",
      contrast: o["contrast"] === true,
      reducedMotion: o["reducedMotion"] === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Writes the attributes tokens.css and HeroUI read. `system` removes data-theme. */
export function applyPrefs(el: HTMLElement, prefs: Prefs): void {
  if (prefs.theme === "system") {
    el.removeAttribute("data-theme");
    el.classList.remove("dark", "light");
    if (el.style) el.style.removeProperty("color-scheme");
  } else {
    el.setAttribute("data-theme", prefs.theme);
    el.classList.toggle("dark", prefs.theme === "dark");
    el.classList.toggle("light", prefs.theme === "light");
    if (el.style) el.style.colorScheme = prefs.theme;
  }
  if (prefs.contrast) el.setAttribute("data-contrast", "more");
  else el.removeAttribute("data-contrast");
  if (prefs.reducedMotion) el.setAttribute("data-motion", "reduced");
  else el.removeAttribute("data-motion");
}
