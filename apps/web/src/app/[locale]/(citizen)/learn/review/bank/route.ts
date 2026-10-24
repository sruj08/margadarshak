import { buildBank, isBankLocale } from "@/features/learn/content/bank-build";

/**
 * The LL question bank for one locale (stems, options and sign descriptions; no answer keys), served
 * as static JSON so it never enters a JS chunk (FRONTEND §9, §14). Built at `next build`.
 */
export const dynamic = "force-static";

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "hi" }];
}

export async function GET(_req: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isBankLocale(locale)) return new Response("Not found", { status: 404 });
  return Response.json(buildBank(locale), {
    headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
  });
}
