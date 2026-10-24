import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TopBar } from "@/components/shell/top-bar";
import { Join } from "@/features/squads/join";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("me.squad");
  return { title: t("joinTitle"), robots: { index: false, follow: false } };
}

/**
 * LRN-035 Squad invite link (`/{locale}/s/{squadId}.{inviteCode}`, our own domain only). Rendered on
 * demand (the token is per squad) and never indexed. The footer comes from `[locale]/layout.tsx`.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; inviteToken: string }>;
}) {
  await enterLocale(params);
  const { inviteToken } = await params;
  const t = await getTranslations("me.squad");
  return (
    <>
      <TopBar minimal />
      <main id="main" tabIndex={-1} className="md-main">
        <div className="md-page md-stack" data-screen="LRN-035">
          <h1 className="md-h1">{t("joinTitle")}</h1>
          <Join token={inviteToken} />
        </div>
      </main>
    </>
  );
}
