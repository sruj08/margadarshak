import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildBank } from "@/features/learn/content/bank-build";
import { allLessonIds, gameTitle, lessonLookup } from "@/features/learn/content/curriculum";
import { gameHref } from "@/features/learn/content/routes";
import { LessonPlayer } from "@/features/learn/lesson/lesson-player";
import { enterLocale } from "@/i18n/page-locale";

export function generateStaticParams() {
  return allLessonIds().map((lessonId) => ({ lessonId }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; lessonId: string }>;
}): Promise<Metadata> {
  const { locale, lessonId } = await params;
  const hit = lessonLookup(lessonId, locale === "hi" ? "hi" : "en");
  return { title: hit?.module.lessons[hit.index]?.title ?? lessonId };
}

/** LRN-004 Lesson player (UI_SPEC_LEARN_GAMES §2.4). */
export default async function LessonPage({
  params,
}: {
  params: Promise<{ locale: string; lessonId: string }>;
}) {
  const locale = await enterLocale(params);
  const { lessonId } = await params;
  const hit = lessonLookup(lessonId, locale);
  if (!hit) notFound();
  const bank = buildBank(locale);
  // LL lessons end with 2 practice questions from their topic, a different pair per lesson.
  const concepts = [
    ...new Set(
      bank.items
        .filter((i) => i.topic === hit.module.id && i.pool === "practice")
        .map((i) => i.concept),
    ),
  ];
  const picks = concepts.slice(hit.index * 2, hit.index * 2 + 2);
  const checkItemIds = picks
    .map((c) => bank.items.find((i) => i.concept === c && i.pool === "practice")?.id)
    .filter((x): x is string => !!x);
  const g = hit.module.games.map((id) => ({ id, href: gameHref(id) })).find((x) => x.href);
  return (
    <div className="md-page">
      <LessonPlayer
        module={hit.module}
        index={hit.index}
        lessonId={lessonId}
        checkItemIds={checkItemIds}
        conceptCounts={bank.conceptCounts}
        game={g?.href ? { title: gameTitle(g.id, locale), href: g.href } : null}
      />
    </div>
  );
}
