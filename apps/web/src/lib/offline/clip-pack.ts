import { CLIP_PACK_CACHE, CLIP_PACK_MATCH } from "./clip-pack-match";

/**
 * Page-side clip-pack API (FRONTEND §8.2, §8.3 "Nazar mock offline after Download practice pack").
 * The page writes the cache; the service worker only reads it (src/app/sw.ts), serving byte ranges
 * to `<video>` from the stored full responses.
 *
 * Rules for callers:
 *  - call `downloadClipPack` only from the handler of an explicit user action, after showing the
 *    pack size (the `userAction: true` field makes that choice visible in review); never prefetch;
 *  - pass the clip URLs from the pack manifest; the media host must answer CORS GETs with a full
 *    200 (no Range) so the response is readable and cacheable;
 *  - offer `removeClipPack` next to the download (the learner manages the storage).
 */

export interface ClipPackDeps {
  caches?: CacheStorage;
  fetch?: typeof fetch;
}

export interface ClipPackProgress {
  done: number;
  total: number;
  bytes: number;
}

export interface DownloadClipPackOptions extends ClipPackDeps {
  urls: readonly string[];
  /** Must be literally `true`: packs are downloaded only on an explicit tap, never silently. */
  userAction: true;
  signal?: AbortSignal;
  onProgress?: (p: ClipPackProgress) => void;
}

export interface ClipPackStatus {
  cached: number;
  total: number;
  complete: boolean;
}

export class ClipPackError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`clip pack download failed for ${url} (HTTP ${status})`);
    this.name = "ClipPackError";
  }
}

function storage(deps: ClipPackDeps): CacheStorage {
  const c = deps.caches ?? globalThis.caches;
  if (!c) throw new Error("Cache Storage is not available in this browser");
  return c;
}

/** True when the browser can store clip packs at all (Cache Storage needs a secure context). */
export function clipPacksSupported(deps: ClipPackDeps = {}): boolean {
  return (deps.caches ?? globalThis.caches) !== undefined;
}

/**
 * Downloads every clip once (already-cached clips are skipped) into `md-clip-pack`. Sequential, so
 * progress is honest and a slow connection is not saturated. Rejects on the first failed clip;
 * clips stored before the failure stay cached and are skipped on the next attempt.
 */
export async function downloadClipPack(opts: DownloadClipPackOptions): Promise<ClipPackProgress> {
  const cache = await storage(opts).open(CLIP_PACK_CACHE);
  const doFetch = opts.fetch ?? globalThis.fetch;
  const progress: ClipPackProgress = { done: 0, total: opts.urls.length, bytes: 0 };
  for (const url of opts.urls) {
    opts.signal?.throwIfAborted();
    if (!(await cache.match(url, CLIP_PACK_MATCH))) {
      const res = await doFetch(url, {
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      // A 206 or an opaque response cannot serve later Range requests; refuse it.
      if (res.status !== 200) throw new ClipPackError(url, res.status);
      const body = await res.blob();
      progress.bytes += body.size;
      await cache.put(url, new Response(body, { status: 200, headers: res.headers }));
    }
    progress.done += 1;
    opts.onProgress?.({ ...progress });
  }
  return progress;
}

/** How many of the pack's clips are already stored. */
export async function clipPackStatus(
  urls: readonly string[],
  deps: ClipPackDeps = {},
): Promise<ClipPackStatus> {
  const c = deps.caches ?? globalThis.caches;
  if (!c || !(await c.has(CLIP_PACK_CACHE))) {
    return { cached: 0, total: urls.length, complete: urls.length === 0 };
  }
  const cache = await c.open(CLIP_PACK_CACHE);
  let cached = 0;
  for (const url of urls) if (await cache.match(url, CLIP_PACK_MATCH)) cached += 1;
  return { cached, total: urls.length, complete: cached === urls.length };
}

/** Removes the pack's clips; returns how many were deleted. */
export async function removeClipPack(
  urls: readonly string[],
  deps: ClipPackDeps = {},
): Promise<number> {
  const c = deps.caches ?? globalThis.caches;
  if (!c || !(await c.has(CLIP_PACK_CACHE))) return 0;
  const cache = await c.open(CLIP_PACK_CACHE);
  let removed = 0;
  for (const url of urls) if (await cache.delete(url, CLIP_PACK_MATCH)) removed += 1;
  return removed;
}

/** Removes every stored clip (Settings → "Remove downloaded packs"). */
export async function clearClipPacks(deps: ClipPackDeps = {}): Promise<boolean> {
  const c = deps.caches ?? globalThis.caches;
  return c ? c.delete(CLIP_PACK_CACHE) : false;
}
