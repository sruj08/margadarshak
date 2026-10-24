import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OfflineBanner } from "@/components/journey/status";
import { SignIn } from "@/components/privacy/sign-in";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signIn");
  return { title: t("title"), robots: { index: false } };
}

/**
 * Sign in with an e-mail link (API-07 / API-08). Needed only for family mode: the adult account
 * holder adds a family member and records parental consent. The device's cases move into the
 * account on sign-in. `?code=` redeems the link; `?return=` is where to go afterwards.
 */
export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page">
      <OfflineBanner />
      <SignIn />
    </div>
  );
}
