import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LanguageScreen } from "@/components/onboarding/language-screen";
import { enterLocale } from "@/i18n/page-locale";
import { LANGUAGE_META, routing } from "@/i18n/routing";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("lang");
  return { title: t("title") };
}

/**
 * SCR-001 Language picker: the very first screen on a new device (the proxy sends "/" here until a
 * language is chosen). Both headings show, each in its own script, so nobody needs English to start.
 */
export default async function LanguagePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await enterLocale(params);
  const t = await getTranslations("lang");
  const other = routing.locales.find((l) => l !== locale) ?? "en";
  const tOther = await getTranslations({ locale: other, namespace: "lang" });
  const tb = await getTranslations("brand");
  return (
    <div className="md-page md-page--narrow" data-screen="SCR-001">
      <LanguageScreen
        brandName={tb("name")}
        current={locale}
        titles={[
          { lang: locale, text: t("title") },
          { lang: other, text: tOther("title") },
        ]}
        hint={t("hint")}
        options={[
          {
            code: "hi",
            nativeName: "हिन्दी",
            englishName: "Hindi",
            lang: "hi",
            caption: LANGUAGE_META.hi.regionLabel,
          },
          {
            code: "en",
            nativeName: "English",
            englishName: "Indian English",
            lang: "en",
            caption: LANGUAGE_META.en.regionLabel,
          },
          {
            code: "doi",
            nativeName: "डोगरी",
            englishName: "Dogri",
            lang: "doi",
            caption: LANGUAGE_META.doi.regionLabel,
          },
          {
            code: "pa",
            nativeName: "ਪੰਜਾਬੀ",
            englishName: "Punjabi",
            lang: "pa",
            caption: LANGUAGE_META.pa.regionLabel,
          },
          {
            code: "mr",
            nativeName: "मराठी",
            englishName: "Marathi",
            lang: "mr",
            caption: LANGUAGE_META.mr.regionLabel,
          },
          {
            code: "gu",
            nativeName: "ગુજરાતી",
            englishName: "Gujarati",
            lang: "gu",
            caption: LANGUAGE_META.gu.regionLabel,
          },
          {
            code: "ta",
            nativeName: "தமிழ்",
            englishName: "Tamil",
            lang: "ta",
            caption: LANGUAGE_META.ta.regionLabel,
          },
        ]}
        more={{ label: t("more"), body: t("moreBody") }}
        cta={t("cta")}
      />
    </div>
  );
}
