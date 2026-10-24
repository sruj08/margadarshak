import "@/features/learn/learn.css";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { buildBank } from "@/features/learn/content/bank-build";
import { allNodeIds, gameTitle, moduleByNode } from "@/features/learn/content/curriculum";
import { gameHref } from "@/features/learn/content/routes";
import { SkillStatus } from "@/features/learn/skill-tree/skill-status";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export function generateStaticParams() {
  return allNodeIds().map((nodeId) => ({ nodeId }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; nodeId: string }>;
}): Promise<Metadata> {
  const { locale, nodeId } = await params;
  const m = moduleByNode(nodeId, locale === "hi" ? "hi" : "en");
  return { title: m?.title ?? nodeId };
}

const HUE: Record<string, string> = {
  ll: "var(--md-topic-signs)",
  survival: "var(--md-topic-survival)",
  dl: "var(--md-topic-rules)",
};

/** LRN-002 Skill node detail (UI_SPEC_LEARN_GAMES §2.2). */
export default async function SkillPage({
  params,
}: {
  params: Promise<{ locale: string; nodeId: string }>;
}) {
  const locale = await enterLocale(params);
  const { nodeId } = await params;
  const m = moduleByNode(nodeId, locale);
  if (!m) notFound();
  const t = await getTranslations("learnHub.skill");
  const bank = buildBank(locale);
  const fact = m.facts[0];
  const topic = /^LL[1-4]$/.test(m.id) ? m.id : null;
  const game = m.games.map((g) => ({ id: g, href: gameHref(g) })).find((g) => g.href !== null);
  const practise = topic
    ? { href: `/learn/review?topic=${topic}`, label: t("practiseReview") }
    : game?.href
      ? { href: game.href, label: t("practiseGame", { game: gameTitle(game.id, locale) }) }
      : null;
  const firstLesson = m.lessons[0];

  return (
    <div className="md-page md-stack" data-screen="LRN-002">
      <Link href="/learn" className="md-link">
        {t("back")}
      </Link>
      <div className="ml-card" style={{ background: HUE[m.branch] }}>
        <p className="ml-small" style={{ color: "var(--md-ink)" }}>
          {m.id}
        </p>
        <h1 className="md-h1" style={{ color: "var(--md-ink)" }}>
          {m.title}
        </h1>
      </div>
      <SkillStatus nodeId={m.nodeId} depth={m.depth} conceptCounts={bank.conceptCounts} />
      {m.depth === "coming" ? <p className="ml-chip">{t("coming")}</p> : null}
      {fact ? (
        <section className="md-stack">
          <h2 className="md-h2">{t("why")}</h2>
          <p>{fact.text}</p>
          {fact.source ? <p className="ml-small">{t("source", { s: fact.source })}</p> : null}
          {!fact.verified ? <p className="ml-small">{t("beingChecked")}</p> : null}
        </section>
      ) : null}
      {m.objectives.length > 0 ? (
        <section className="md-stack">
          <h2 className="md-h2">{t("learn")}</h2>
          <ul>
            {m.objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="ml-actions">
        {practise ? (
          <Link
            href={practise.href}
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          >
            {practise.label}
          </Link>
        ) : null}
        {firstLesson ? (
          <Link href={`/learn/lesson/${firstLesson.id}`} className="md-link">
            {t("lesson", { title: firstLesson.title })}
          </Link>
        ) : null}
      </div>
      {m.lessons.length > 1 ? (
        <section className="md-stack">
          <h2 className="md-h2">{t("lessons")}</h2>
          <ol className="ml-list">
            {m.lessons.map((l) => (
              <li key={l.id}>
                <Link href={`/learn/lesson/${l.id}`} className="ml-node">
                  <span className="ml-node__text">{l.title}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
