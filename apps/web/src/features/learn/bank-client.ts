import type { Bank, PracticeKey } from "./content/bank-types";

/**
 * Loads the locale question bank and the practice key from the learn data routes
 * (`/{locale}/learn/review/bank`, `/{locale}/learn/review/practice-key`, static JSON built from
 * `@content/generated`). The last good copy is kept in localStorage so reviews keep working offline
 * even without the service worker. JSON, not a JS chunk: it never counts against the bundle budget.
 */

const memo = new Map<string, Promise<unknown>>();

function cacheKey(kind: string, locale: string): string {
  return `md.learn.${kind}.${locale}.v1`;
}

async function load<T>(kind: "bank" | "practice-key", locale: string): Promise<T> {
  const key = `${kind}:${locale}`;
  const hit = memo.get(key);
  if (hit) return hit as Promise<T>;
  const p = (async () => {
    try {
      const res = await fetch(`/${locale}/learn/review/${kind}`, { cache: "no-cache" });
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      try {
        localStorage.setItem(cacheKey(kind, locale), text);
      } catch {
        // storage full: the network copy still works for this view
      }
      return JSON.parse(text) as T;
    } catch (e) {
      try {
        const saved = localStorage.getItem(cacheKey(kind, locale));
        if (saved) return JSON.parse(saved) as T;
      } catch {
        // fall through
      }
      memo.delete(key);
      throw e;
    }
  })();
  memo.set(key, p);
  return p;
}

export function loadBank(locale: string): Promise<Bank> {
  return load<Bank>("bank", locale);
}

export function loadPracticeKey(locale: string): Promise<PracticeKey> {
  return load<PracticeKey>("practice-key", locale);
}

export function clearBankCache(): void {
  memo.clear();
  for (const l of ["en", "hi"])
    for (const k of ["bank", "practice-key"])
      try {
        localStorage.removeItem(cacheKey(k, l));
      } catch {
        // ignore
      }
}
