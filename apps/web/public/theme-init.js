/*
 * Applies saved display preferences before first paint (no flash of the wrong theme).
 * Mirrors src/lib/prefs/prefs.ts (key "md.prefs"); loaded as a same-origin script so the CSP needs no
 * inline-script exception for it. Lite mode is suggested on 2G / Save-Data (FRONTEND §9).
 */
(() => {
  const el = document.documentElement;
  let prefs = null;
  try {
    const raw = localStorage.getItem("md.prefs");
    prefs = raw ? JSON.parse(raw) : null;
  } catch (_e) {
    prefs = null; // storage disabled: follow the OS
  }
  if (prefs && (prefs.theme === "light" || prefs.theme === "dark")) {
    el.setAttribute("data-theme", prefs.theme);
    el.classList.add(prefs.theme);
  }
  if (prefs && prefs.contrast === true) el.setAttribute("data-contrast", "more");
  if (prefs && prefs.reducedMotion === true) el.setAttribute("data-motion", "reduced");
  const c = navigator.connection;
  if (c && (c.saveData || c.effectiveType === "2g" || c.effectiveType === "slow-2g")) {
    el.setAttribute("data-lite", "true");
  }
})();
