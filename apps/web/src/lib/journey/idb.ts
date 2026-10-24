/**
 * Minimal IndexedDB key-value store (no dependency). Used for application drafts (MD-110, EC-11),
 * the write outbox and the on-device vault. Falls back to localStorage when IndexedDB is missing
 * (old WebViews, private mode), so a draft is never lost silently.
 */

const DB_NAME = "md-journey";
const STORES = ["drafts", "outbox", "vault"] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function hasIdb(): boolean {
  return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES)
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("indexeddb blocked"));
  }).catch((e: unknown) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function lsKey(store: StoreName, key: string): string {
  return `md.idb.${store}.${key}`;
}

async function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = run(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  if (hasIdb()) {
    try {
      return (await tx(store, "readonly", (s) => s.get(key))) as T | undefined;
    } catch {
      // fall through to localStorage
    }
  }
  try {
    const raw = localStorage.getItem(lsKey(store, key));
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  if (hasIdb()) {
    try {
      await tx(store, "readwrite", (s) => s.put(value, key));
      return;
    } catch {
      // fall through
    }
  }
  try {
    localStorage.setItem(lsKey(store, key), JSON.stringify(value));
  } catch {
    // nothing else to try
  }
}

export async function idbDel(store: StoreName, key: string): Promise<void> {
  if (hasIdb()) {
    try {
      await tx(store, "readwrite", (s) => s.delete(key));
    } catch {
      // ignore
    }
  }
  try {
    localStorage.removeItem(lsKey(store, key));
  } catch {
    // ignore
  }
}

export async function idbEntries<T>(store: StoreName): Promise<Array<[string, T]>> {
  const out: Array<[string, T]> = [];
  if (hasIdb()) {
    try {
      const keys = (await tx(store, "readonly", (s) => s.getAllKeys())) as IDBValidKey[];
      for (const k of keys) {
        const v = await idbGet<T>(store, String(k));
        if (v !== undefined) out.push([String(k), v]);
      }
      return out;
    } catch {
      // fall through
    }
  }
  try {
    const prefix = `md.idb.${store}.`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) {
        const raw = localStorage.getItem(k);
        if (raw !== null) out.push([k.slice(prefix.length), JSON.parse(raw) as T]);
      }
    }
  } catch {
    // ignore
  }
  return out;
}
