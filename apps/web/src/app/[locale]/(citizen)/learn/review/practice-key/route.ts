import { buildPracticeKey, isBankLocale } from "@/features/learn/content/bank-build";

/**
 * Answer keys and reviewed explanations for PRACTICE items only (`ll-bank.practice-key.json`).
 * Mock-pool keys never leave the server (GAME_DESIGN §11.10): a mock is scored by the server, or
 * provisionally on the phone from practice items only.
 */
export const dynamic = "force-static";

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "hi" }];
}

export async function GET(_req: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isBankLocale(locale)) return new Response("Not found", { status: 404 });
  return Response.json(buildPracticeKey(locale), {
    headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
  });
}
