/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import {
  CacheFirst,
  type PrecacheEntry,
  RangeRequestsPlugin,
  type RuntimeCaching,
  Serwist,
  type SerwistGlobalConfig,
  type SerwistPlugin,
} from "serwist";
import {
  CLIP_PACK_CACHE,
  CLIP_PACK_MATCH,
  isClipMediaRequest,
} from "../lib/offline/clip-pack-match";

/**
 * Service worker (FRONTEND §8). Precaches the app shell assets and the offline pages; Next's default
 * runtime caching handles pages and chunks. No personal API data is cached here in P0, and nothing is
 * downloaded silently (packs are explicit downloads in P1).
 *
 * P2 clip packs (`md-clip-pack`, FRONTEND §8.2): opt-in only. The page stores clips after an
 * explicit "Download practice pack" tap (src/lib/offline/clip-pack.ts); this worker serves them
 * cache-first with HTTP Range support (video seeks need byte ranges from the cached full file) and
 * never writes to the cache itself, so streaming a clip online stores nothing. The route sits ahead
 * of `defaultCache`, whose video rule would otherwise cache every same-origin .mp4 it sees.
 */
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Serves a 206 slice of the cached full clip when the request has a Range header. Wrapped in a plain
// object because the class declares its hook as possibly undefined (exactOptionalPropertyTypes).
const ranges = new RangeRequestsPlugin();
const rangePlugin: SerwistPlugin = {
  cachedResponseWillBeUsed: async (param) =>
    ranges.cachedResponseWillBeUsed ? ranges.cachedResponseWillBeUsed(param) : param.cachedResponse,
};

const clipPack: RuntimeCaching = {
  matcher: ({ request }) => isClipMediaRequest(request),
  handler: new CacheFirst({
    cacheName: CLIP_PACK_CACHE,
    matchOptions: CLIP_PACK_MATCH,
    plugins: [
      // Read-only: a network response is passed through and never stored (no silent downloads).
      { cacheWillUpdate: async () => null },
      rangePlugin,
    ],
  }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST ?? [],
  // The update waits: the app never reloads itself mid-application or mid-game (FRONTEND §8.1).
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [clipPack, ...defaultCache],
  fallbacks: {
    entries: [
      {
        url: "/hi/offline",
        matcher({ request }) {
          return (
            request.destination === "document" && new URL(request.url).pathname.startsWith("/hi")
          );
        },
      },
      {
        url: "/en/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
