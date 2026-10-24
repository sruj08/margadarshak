/**
 * Shared by the service worker (src/app/sw.ts) and the page-side pack helpers (./clip-pack.ts).
 * Keep this file free of DOM-only and Node-only APIs: it is bundled into the worker.
 *
 * Clip packs (FRONTEND §8.2, F-23): Nazar clips and game media are cached only after the learner
 * taps "Download practice pack (≈ N MB)". The worker serves what is in the cache (with HTTP Range
 * support) and never writes to it, so nothing is downloaded or stored silently (dark-pattern rule).
 */
export const CLIP_PACK_CACHE = "md-clip-pack";

/**
 * Cache lookups ignore the query string (presigned media URLs change their signature on every
 * issue) and Vary (a `<video>` request carries no Origin header, the CORS download did). Clip URLs
 * must therefore be unique by origin + path.
 */
export const CLIP_PACK_MATCH: CacheQueryOptions = { ignoreSearch: true, ignoreVary: true };

const CLIP_FILE = /\.(?:mp4|webm|m4v)$/i;

export interface ClipRequestLike {
  method: string;
  destination: string;
  url: string;
}

/** True for a GET of clip media: a `<video>` request, or a fetch of an .mp4/.webm/.m4v file. */
export function isClipMediaRequest(req: ClipRequestLike): boolean {
  if (req.method !== "GET") return false;
  if (req.destination === "video") return true;
  try {
    return CLIP_FILE.test(new URL(req.url).pathname);
  } catch {
    return false;
  }
}
