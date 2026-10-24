/**
 * Whole-clip preload (EC-18, FRONTEND §10.3 step 1): every clip of the session is fetched in full
 * into memory before the session can start, so there is no streaming during a scored clip and the
 * buffering failure mode is gone. Downloaded packs are served by the service worker from the
 * `md-clip-pack` cache, so the same fetch works offline.
 */

export class PreloadError extends Error {
  constructor(
    public readonly code: "http" | "hash" | "aborted" | "network",
    message: string,
  ) {
    super(message);
  }
}

export interface PreloadProgress {
  loaded: number;
  total: number;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function openClip(
  url: string,
  f: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const sameOrigin =
    typeof location !== "undefined" && new URL(url, location.href).origin === location.origin;
  try {
    return await f(url, {
      ...(signal ? { signal } : {}),
      credentials: sameOrigin ? "same-origin" : "omit",
      mode: sameOrigin ? "same-origin" : "cors",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new PreloadError("aborted", "aborted");
    throw new PreloadError("network", (e as Error).message);
  }
}

/** Reads the whole body, reporting bytes as they arrive. */
async function readBody(res: Response, onBytes?: (n: number) => void): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  if (!res.body || typeof res.body.getReader !== "function") {
    const buf = new Uint8Array(await res.arrayBuffer());
    onBytes?.(buf.byteLength);
    return [buf];
  }
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    if (value) {
      chunks.push(value);
      onBytes?.(value.byteLength);
    }
  }
}

/** Fetches one clip to a Blob, reporting bytes as they arrive; checks sha256 when given. */
export async function preloadClip(
  url: string,
  opts: {
    signal?: AbortSignal;
    sha256?: string;
    onBytes?: (n: number) => void;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<Blob> {
  const res = await openClip(url, opts.fetchImpl ?? fetch, opts.signal);
  if (!res.ok) throw new PreloadError("http", `HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "application/octet-stream";
  const blob = new Blob((await readBody(res, opts.onBytes)) as BlobPart[], { type });
  if (opts.sha256) {
    const got = await sha256Hex(await blob.arrayBuffer());
    if (got !== opts.sha256.toLowerCase()) throw new PreloadError("hash", "clip hash mismatch");
  }
  return blob;
}

/**
 * Preloads every clip in order. `total` is the sum of the expected sizes (API-34 `bytes`), so the
 * ring is determinate from the first byte; it grows if a clip turns out larger.
 */
export async function preloadAll(
  clips: readonly { url: string; bytes?: number; sha256?: string }[],
  opts: {
    signal?: AbortSignal;
    onProgress?: (p: PreloadProgress) => void;
    fetchImpl?: typeof fetch;
  },
): Promise<Blob[]> {
  let total = clips.reduce((s, c) => s + (c.bytes ?? 0), 0);
  let loaded = 0;
  const out: Blob[] = [];
  opts.onProgress?.({ loaded, total });
  for (const c of clips) {
    const blob = await preloadClip(c.url, {
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(c.sha256 ? { sha256: c.sha256 } : {}),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      onBytes: (n) => {
        loaded += n;
        total = Math.max(total, loaded);
        opts.onProgress?.({ loaded, total });
      },
    });
    out.push(blob);
  }
  opts.onProgress?.({ loaded, total: Math.max(total, loaded) });
  return out;
}

/** Resolves once a <video> holding a Blob URL can play through to the end (EC-18 rule). */
export function waitPlayable(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const ready = () => {
      const d = video.duration;
      const buffered = video.buffered.length > 0 ? video.buffered.end(0) : 0;
      return video.readyState >= 4 && Number.isFinite(d) && buffered >= d - 0.1;
    };
    if (ready()) return resolve();
    const check = () => {
      if (!ready()) return;
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new PreloadError("network", "video failed to load"));
    };
    const cleanup = () => {
      video.removeEventListener("canplaythrough", check);
      video.removeEventListener("progress", check);
      video.removeEventListener("error", fail);
      signal?.removeEventListener("abort", fail);
    };
    video.addEventListener("canplaythrough", check);
    video.addEventListener("progress", check);
    video.addEventListener("error", fail);
    signal?.addEventListener("abort", fail);
  });
}
