import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SarathiReplica } from "@/components/lab/sarathi-replica";
import { enterLocale } from "@/i18n/page-locale";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Journey-test lab",
  robots: { index: false, follow: false, nocache: true },
};

/** Constant-time compare so the token cannot be guessed byte by byte. */
function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Journey-test lab replica `/lab/sarathi-sequence` (MD-139, MD-140). Reachable only with
 * `?token=` equal to the LAB_TOKEN env var (404 otherwise, also when LAB_TOKEN is unset),
 * `noindex` (meta robots here, X-Robots-Tag header in next.config). The same token is sent to
 * API-70 as `X-Lab-Token` (the API's LAB_TOKENS must include it).
 */
export default async function LabPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await enterLocale(params);
  const sp = await searchParams;
  const token = typeof sp["token"] === "string" ? sp["token"] : "";
  const expected = process.env["LAB_TOKEN"] ?? "";
  if (!expected || !sameToken(token, expected)) notFound();
  const t = await getTranslations("lab");
  return (
    <div data-screen="LAB-139">
      <p className="mj-lab-banner" role="note" lang="en">
        Research replica of public Sarathi screens. Not a government site.
      </p>
      <div className="mj-lab-frame">
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0" }}>{t("h1")}</h1>
        <p>{t("intro")}</p>
        <SarathiReplica labToken={token} />
      </div>
    </div>
  );
}
