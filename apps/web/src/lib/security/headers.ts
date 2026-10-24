/**
 * Security headers (MD-025, FRONTEND §13). No third-party scripts, styles, fonts, frames or analytics:
 * every fetch goes to our own origin or our API. Fonts are self-hosted by next/font.
 *
 * script-src keeps 'unsafe-inline' because statically rendered App Router pages carry inline RSC
 * bootstrap scripts and cannot receive a per-request nonce without making every page dynamic (which
 * would break offline HTML caching). Third-party script origins stay blocked. Moving to a nonce +
 * 'strict-dynamic' policy is tracked for P1 together with the dynamic case pages.
 */

export interface CspOptions {
  isDev: boolean;
  /** Extra origins the browser may call (API base URL, WebSocket base URL). */
  connect?: readonly string[];
  /**
   * Clip media hosts (`NEXT_PUBLIC_MEDIA_HOST`, P2 Nazar clips and game packs). Each one is allowed
   * in media-src (playback), img-src (posters) and connect-src (the whole-file preload to a Blob URL
   * and the explicit pack download, FRONTEND §10.3 and §8.2). A bare host name means https.
   */
  media?: readonly string[];
}

function origin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** `https://media.example.in/x` or `media.example.in` → `https://media.example.in`; junk → null. */
export function mediaOrigin(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return origin(/^[a-z][a-z\d+.-]*:\/\//i.test(v) ? v : `https://${v}`);
}

export function buildCsp({ isDev, connect = [], media = [] }: CspOptions): string {
  const mediaSrc = media.map((m) => mediaOrigin(m)).filter((m): m is string => !!m);
  const connectSrc = [
    "'self'",
    ...connect.map((c) => origin(c)).filter((c): c is string => !!c),
    ...mediaSrc,
  ];
  if (isDev) connectSrc.push("ws:", "wss:");
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [...new Set(["'self'", "data:", "blob:", ...mediaSrc])],
    "font-src": ["'self'"],
    "connect-src": [...new Set(connectSrc)],
    // blob: plays clips preloaded whole into a Blob URL (no streaming during a scored clip, EC-18).
    "media-src": [...new Set(["'self'", "blob:", ...mediaSrc])],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

export interface Header {
  key: string;
  value: string;
}

export function securityHeaders(opts: CspOptions): Header[] {
  return [
    { key: "Content-Security-Policy", value: buildCsp(opts) },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      // Camera and microphone are granted per route when the photo fixer and voice guide ship (P1).
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ];
}
