import { type NextRequest, NextResponse } from "next/server";

/**
 * Sign-in links are e-mailed as `${WEB_BASE_URL}/auth/magic?code=…` (API-07); the sign-in screen
 * lives at /{locale}/signin. Returns the redirect for that path, or null for any other path.
 */
export function magicLinkRedirect(req: NextRequest): NextResponse | null {
  if (req.nextUrl.pathname !== "/auth/magic") return null;
  const cookie = req.cookies.get("NEXT_LOCALE")?.value;
  const accept = req.headers.get("accept-language") ?? "";
  const locale = cookie === "hi" || (cookie !== "en" && /(^|,)\s*hi\b/i.test(accept)) ? "hi" : "en";
  const url = new URL(`/${locale}/signin`, req.url);
  const code = req.nextUrl.searchParams.get("code");
  if (code) url.searchParams.set("code", code);
  return NextResponse.redirect(url, 307);
}
