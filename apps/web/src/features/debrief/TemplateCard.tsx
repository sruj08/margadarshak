"use client";

import type { CardPoint, DebriefCard } from "@margdarshak/game-core/debrief";
import { unescapeHtml } from "@margdarshak/game-core/debrief";
import type { Finding } from "@margdarshak/game-core/schema";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { SourceChip } from "@margdarshak/ui/components/source-chip";
import { formatIsoDate } from "@margdarshak/ui/lib/format";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { drillHref } from "./build-card";
import { CoachFeedback, WhyNumbers } from "./WhyNumbers";

/** Findings a replay can show: Nazar findings tied to one clip. */
export function replayable(f: Finding | undefined): boolean {
  if (!f?.findingId.startsWith("NAZ_")) return false;
  return typeof f.facts["clip_ordinal"] === "number" || typeof f.itemRef === "string";
}

/**
 * The debrief card (DEBRIEF_SPEC §0.1, §7.2, §9; UI_SPEC_LEARN_GAMES §6.1): four sections as four
 * `<section>`s with headings, read as a document. Labelled "Auto notes" for the template card and
 * "Practice and familiarisation, not certification" at the foot. A rule chip appears only for a
 * verified rule (none today: `rule` is null for UNKNOWN). Text was HTML-escaped by game-core (V9)
 * and is unescaped here because React escapes text nodes itself.
 */
export function TemplateCard({
  card,
  findings,
  sid,
  source,
}: {
  card: DebriefCard;
  findings: readonly Finding[];
  sid: string;
  source: "template" | "coach";
}) {
  const t = useTranslations("games");
  const locale = useLocale();
  const byId = new Map(findings.map((f) => [f.findingId, f]));
  const text = (s: string) => unescapeHtml(s);

  const chip = (p: CardPoint) =>
    p.rule ? (
      <SourceChip
        source={p.rule.id}
        checked={
          p.rule.verified_on
            ? t("checkedOn", { date: formatIsoDate(p.rule.verified_on, locale, "long") })
            : t("source.unchecked")
        }
        sourceTitle={p.rule.source_title}
        {...(p.rule.source_url ? { sourceUrl: p.rule.source_url } : {})}
        detail={p.rule.text}
        labels={{
          heading: t("source.heading"),
          openSource: t("source.open"),
          newTab: t("source.newTab"),
        }}
      />
    ) : null;

  return (
    <article className="mg-debrief" data-testid="debrief-card" data-source={source}>
      <p className="mg-debrief__label">
        <span className="mg-chip" data-testid="debrief-notes-label">
          {card.notes_label}
        </span>
        {source === "coach" ? <span className="mg-note">{t("debrief.boundary")}</span> : null}
      </p>
      {card.notices.map((n) => (
        <p key={n} className="mg-callout">
          {n}
        </p>
      ))}

      <section className="mg-debrief__section" aria-labelledby="db-how">
        <h2 id="db-how" className="md-h3">
          {t("debrief.how")}
        </h2>
        <p>{text(card.how_you_did)}</p>
      </section>

      <section
        className="mg-debrief__section mg-debrief__section--lacked"
        aria-labelledby="db-lacked"
      >
        <h2 id="db-lacked" className="md-h3">
          {t("debrief.lacked")}
        </h2>
        {card.where_you_lacked.length === 0 ? (
          <p>{t("debrief.nothing")}</p>
        ) : (
          <ol className="mg-debrief__list">
            {card.where_you_lacked.map((p) => {
              const f = byId.get(p.findingId);
              return (
                <li key={p.findingId} data-finding={p.findingId}>
                  {f?.critical ? (
                    <span className="mg-critical">
                      <span aria-hidden="true">⬣ </span>
                      {t("debrief.critical")}
                    </span>
                  ) : null}
                  <p>{text(p.text)}</p>
                  {replayable(f) ? (
                    <Link
                      href={`/learn/practise/sessions/${sid}/replay/${p.findingId}`}
                      className="md-link"
                      data-testid="debrief-watch"
                    >
                      {t("debrief.watch")}
                    </Link>
                  ) : null}
                  {chip(p)}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {card.what_you_could_have_done.length > 0 ? (
        <section className="mg-debrief__section" aria-labelledby="db-could">
          <h2 id="db-could" className="md-h3">
            {t("debrief.could")}
          </h2>
          <ol className="mg-debrief__list">
            {card.what_you_could_have_done.map((p) => (
              <li key={p.findingId}>
                <p>{text(p.text)}</p>
                {chip(p)}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="mg-debrief__section" aria-labelledby="db-next">
        <h2 id="db-next" className="md-h3">
          {t("debrief.next")}
        </h2>
        <p>{text(card.next_drill.why)}</p>
        <Link
          href={drillHref(card.next_drill.deeplink, card.next_drill.drillId)}
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          data-testid="debrief-drill"
          data-drill={card.next_drill.drillId}
        >
          {t("debrief.cta")}
        </Link>
      </section>

      {card.improved_since_last ? <p className="mg-note">{t("debrief.improved")}</p> : null}
      <WhyNumbers findings={findings} />
      {source === "coach" ? <CoachFeedback sid={sid} /> : null}
      <p className="mg-label mg-label--ink" data-testid="debrief-footer">
        {card.label}
      </p>
    </article>
  );
}
