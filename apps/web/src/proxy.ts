import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { isAppLocale, routing } from "./i18n/routing";
import { magicLinkRedirect } from "./lib/journey/magic-link";

/**
 * Next.js 16 proxy (formerly middleware.ts).
 * 1. First run: a new device opening home goes to the language picker (SCR-001), then the launch
 *    notice (SCR-002), once per device. Deep links are never blocked.
 * 2. Everything else: next-intl locale negotiation (URL prefix, cookie, Accept-Language).
 */
const intl = createMiddleware(routing);

const HOME = /^\/(?:(en|hi)\/?)?$/;

function suggestedLocale(req: NextRequest, fromPath: string | undefined): "en" | "hi" {
  if (isAppLocale(fromPath)) return fromPath;
  const cookie = req.cookies.get("NEXT_LOCALE")?.value;
  if (isAppLocale(cookie)) return cookie;
  const accept = req.headers.get("accept-language") ?? "";
  return /(^|,)\s*hi\b/i.test(accept) ? "hi" : "en";
}

export default function proxy(req: NextRequest) {
  const magic = magicLinkRedirect(req);
  if (magic) return magic;
  const match = HOME.exec(req.nextUrl.pathname);
  if (match) {
    const locale = suggestedLocale(req, match[1]);
    if (!req.cookies.has("md_lang")) {
      return NextResponse.redirect(new URL(`/${locale}/language`, req.url));
    }
    if (!req.cookies.has("md_welcome")) {
      return NextResponse.redirect(new URL(`/${locale}/welcome`, req.url));
    }
  }
  return intl(req);
}

export const config = {
  // Skip API routes, Next internals, the service worker route, PWA icons and any file with an extension.
  matcher: ["/((?!api|_next|_vercel|serwist|pwa|.*\\..*).*)"],
};
