/**
 * First-run flags and "Clear this device" (MD-005, EC-14 shared phone / cyber café).
 * The proxy reads the two onboarding cookies to send a new device to the language picker and then
 * the launch disclaimer; clearing the device removes them, so the disclaimer appears again.
 */

export const COOKIE_LANG_CHOSEN = "md_lang";
export const COOKIE_WELCOMED = "md_welcome";
export const COOKIE_LOCALE = "NEXT_LOCALE";
const ONE_YEAR = 60 * 60 * 24 * 365;
/** Journey drafts, the learning review queue and the game-session queue (packages/game-core). */
const KNOWN_DATABASES = ["md-journey", "md-learn", "margdarshak-game-queue"];

export function setDeviceCookie(name: string, value: string, maxAge = ONE_YEAR): void {
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: plain first-party flags; Cookie Store API is not on every target Android WebView
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
}

function expireCookie(name: string): void {
  // biome-ignore lint/suspicious/noDocumentCookie: see setDeviceCookie
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

export function rememberLanguage(locale: string): void {
  setDeviceCookie(COOKIE_LOCALE, locale);
  setDeviceCookie(COOKIE_LANG_CHOSEN, "1");
}

export function rememberWelcome(): void {
  setDeviceCookie(COOKIE_WELCOMED, "1");
}

/** Removes every Margdarshak value from this browser profile. Returns when storage is cleared. */
export async function clearThisDevice(): Promise<void> {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // Storage can be disabled (private mode); nothing to clear then.
  }
  for (const name of [COOKIE_LOCALE, COOKIE_LANG_CHOSEN, COOKIE_WELCOMED, "md_lite", "md_sid"]) {
    expireCookie(name);
  }
  try {
    if ("indexedDB" in globalThis) {
      // Every database the browser lists, plus the known ones for browsers without databases().
      const names = new Set(KNOWN_DATABASES);
      if (typeof indexedDB.databases === "function") {
        for (const db of await indexedDB.databases()) if (db.name) names.add(db.name);
      }
      await Promise.all(
        [...names].map(
          (name) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = req.onerror = req.onblocked = () => resolve();
            }),
        ),
      );
    }
    if ("caches" in globalThis) {
      // Personal runtime caches only; the app-shell precache holds no personal data.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("pages")).map((k) => caches.delete(k)));
    }
  } catch {
    // Best effort: cookies and storage are already gone.
  }
}
