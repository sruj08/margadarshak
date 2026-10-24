import { useSyncExternalStore } from "react";

/**
 * Small device records for the learn screens (localStorage; this phone only; no PII). The review log
 * itself and the API-32 outbox live in IndexedDB (./review-store.ts). Listeners let components
 * subscribe with useSyncExternalStore. "Clear this device" wipes every `md.learn.*` key.
 */

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

export const LEARN_KEYS = {
  seen: "md.learn.seen.v1",
  xp: "md.learn.xp.v1",
  activity: "md.learn.activity.v1",
  weeks: "md.learn.weeks.v1",
  streak: "md.learn.streak.v1",
  nodes: "md.learn.nodes.v1",
  lessons: "md.learn.lessons.v1",
  llsim: "md.learn.llsim.v1",
  guided: "md.learn.guided.v1",
  decl: "md.learn.decl.v1",
  consent: "md.learn.consent.v1",
  squads: "md.learn.squads.v1",
  mockServer: "md.learn.mock-server.v1",
  readiness: "md.learn.readiness.v1",
  rank: "md.learn.rank.v1",
} as const;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readKv<T>(key: string, fallback: T): T {
  const s = storage();
  let raw: string | null = null;
  try {
    raw = s ? s.getItem(key) : null;
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

export function writeKv(key: string, value: unknown): void {
  const s = storage();
  try {
    if (value === null || value === undefined) s?.removeItem(key);
    else s?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or disabled: the value lasts for this page view only.
  }
  cache.delete(key);
  for (const l of listeners.get(key) ?? []) l();
}

export function subscribeKv(key: string, l: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === key) {
      cache.delete(key);
      l();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    set?.delete(l);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Subscribes a component to one record. The server snapshot is always the fallback. */
export function useKv<T>(key: string, fallback: T): T {
  return useSyncExternalStore(
    (l) => subscribeKv(key, l),
    () => readKv(key, fallback),
    () => fallback,
  );
}

export function clearLearnKv(): void {
  for (const key of Object.values(LEARN_KEYS)) writeKv(key, null);
}
