import { describe, expect, it, vi } from "vitest";
import {
  ClipPackError,
  clearClipPacks,
  clipPackStatus,
  downloadClipPack,
  removeClipPack,
} from "./clip-pack";
import { CLIP_PACK_CACHE, isClipMediaRequest } from "./clip-pack-match";

/** Minimal in-memory CacheStorage: keys ignore the query string, like CLIP_PACK_MATCH. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (u: RequestInfo | URL) => {
    const url = new URL(typeof u === "string" ? u : u instanceof URL ? u.href : u.url);
    return url.origin + url.pathname;
  };
  const cache = (m: Map<string, Response>) =>
    ({
      match: async (u: RequestInfo | URL) => m.get(key(u))?.clone(),
      put: async (u: RequestInfo | URL, r: Response) => void m.set(key(u), r),
      delete: async (u: RequestInfo | URL) => m.delete(key(u)),
    }) as unknown as Cache;
  const storage = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      return cache(stores.get(name) as Map<string, Response>);
    },
    has: async (name: string) => stores.has(name),
    delete: async (name: string) => stores.delete(name),
  } as unknown as CacheStorage;
  return { storage, stores };
}

const A = "https://media.example.in/clips/JMU-0012@3.mp4";
const B = "https://media.example.in/clips/JMU-0013@1.mp4?X-Amz-Signature=abc";

describe("clip packs (FRONTEND §8.2, opt-in md-clip-pack)", () => {
  it("matches clip media GETs only", () => {
    expect(isClipMediaRequest({ method: "GET", destination: "video", url: "https://x.in/a" })).toBe(
      true,
    );
    expect(isClipMediaRequest({ method: "GET", destination: "", url: B })).toBe(true);
    expect(isClipMediaRequest({ method: "POST", destination: "video", url: A })).toBe(false);
    expect(
      isClipMediaRequest({ method: "GET", destination: "image", url: "https://x.in/a.png" }),
    ).toBe(false);
  });

  it("stores each clip once on an explicit download, reports progress, and skips cached clips", async () => {
    const { storage, stores } = fakeCaches();
    const fetchFn = vi.fn(async () => new Response(new Uint8Array(10), { status: 200 }));
    const progress: number[] = [];
    const first = await downloadClipPack({
      urls: [A, B],
      userAction: true,
      caches: storage,
      fetch: fetchFn as unknown as typeof fetch,
      onProgress: (p) => progress.push(p.done),
    });
    expect(first).toEqual({ done: 2, total: 2, bytes: 20 });
    expect(progress).toEqual([1, 2]);
    expect(stores.get(CLIP_PACK_CACHE)?.size).toBe(2);
    expect(fetchFn).toHaveBeenCalledWith(A, expect.objectContaining({ mode: "cors" }));

    await downloadClipPack({
      urls: [A, `${B.split("?")[0]}?X-Amz-Signature=new`],
      userAction: true,
      caches: storage,
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(await clipPackStatus([A, B], { caches: storage })).toEqual({
      cached: 2,
      total: 2,
      complete: true,
    });
  });

  it("refuses partial (206) or failed responses, which cannot serve Range requests later", async () => {
    const { storage } = fakeCaches();
    const fetchFn = async () => new Response("x", { status: 206 });
    await expect(
      downloadClipPack({ urls: [A], userAction: true, caches: storage, fetch: fetchFn }),
    ).rejects.toBeInstanceOf(ClipPackError);
    expect(await clipPackStatus([A], { caches: storage })).toMatchObject({ cached: 0 });
  });

  it("status, remove and clear work without a cache and after a download", async () => {
    const { storage } = fakeCaches();
    expect(await clipPackStatus([A], { caches: storage })).toEqual({
      cached: 0,
      total: 1,
      complete: false,
    });
    expect(await removeClipPack([A], { caches: storage })).toBe(0);
    await downloadClipPack({
      urls: [A, B],
      userAction: true,
      caches: storage,
      fetch: async () => new Response("v", { status: 200 }),
    });
    expect(await removeClipPack([A], { caches: storage })).toBe(1);
    expect(await clipPackStatus([A, B], { caches: storage })).toMatchObject({ cached: 1 });
    expect(await clearClipPacks({ caches: storage })).toBe(true);
    expect(await clipPackStatus([B], { caches: storage })).toMatchObject({ cached: 0 });
  });
});
