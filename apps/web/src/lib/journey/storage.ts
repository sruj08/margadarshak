/**
 * Small, typed device storage. Everything here lives on this phone only and is wiped by
 * "Clear this device" (EC-14). localStorage for small records the UI reads synchronously
 * (active case pointer, plan records), IndexedDB (idb.ts) for drafts, the outbox and the vault.
 * Listeners let React subscribe with useSyncExternalStore.
 */

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

function notify(key: string): void {
  for (const l of listeners.get(key) ?? []) l();
}

export function readJson<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    raw = null;
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: T = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  cache.set(key, { raw, value });
  return value;
}

export function writeJson(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or disabled: the value lasts for this page view only.
  }
  cache.delete(key);
  notify(key);
}

export function subscribe(key: string, listener: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === key || e.key === null) {
      cache.delete(key);
      listener();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    set?.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function newId(prefix: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : Math.random().toString(36).slice(2, 22);
  return `${prefix}_${rnd}`;
}

/** Storage keys (one place, so "Clear this device" and the export see every key). */
export const KEYS = {
  plans: "md.plans.v1",
  planDraft: "md.plan.draft.v1",
  activeCase: "md.case.active.v1",
  persona: "md.demo.persona.v1",
  mock: "md.mock.api.v1",
  labLog: "md.lab.log.v1",
  privacy: "md.privacy.v1",
  analyticsConsent: "md.analytics.consent.v1",
  signInReturn: "md.signin.return.v1",
} as const;
