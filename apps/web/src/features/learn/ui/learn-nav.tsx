import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * Learn sub-navigation (UI_SPEC_LEARN_GAMES §1.3): Learn · Practise · Me. Navigation, not a tab
 * panel, so it is a <nav> of links with aria-current. Server component: no client JS of its own.
 */
export async function LearnNav({ active }: { active: "learn" | "practise" | "me" }) {
  const t = await getTranslations("learnHub.nav");
  const items = [
    { key: "learn", href: "/learn" },
    { key: "practise", href: "/learn/practise" },
    { key: "me", href: "/learn/me" },
  ] as const;
  return (
    <nav aria-label={t("label")} className="ml-nav">
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={active === i.key ? "page" : undefined}>
          {t(i.key)}
        </Link>
      ))}
    </nav>
  );
}
