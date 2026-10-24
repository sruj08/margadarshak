"use client";

import { Button } from "@margdarshak/ui/components/button";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ShareCardView } from "@/features/share/ShareCardView";
import { type CheckedLike, type StudyScore, studyScore } from "./score";
import { StudyLoading } from "./states";

async function readChecked(sid: string | undefined): Promise<CheckedLike | null> {
  if (!sid) return null;
  const { getSessionRecord } = await import("@/features/games/results-store");
  const c = getSessionRecord(sid)?.checked;
  return c
    ? { server_checked: c.server_checked, score: { raw: c.score.raw, max: c.score.max } }
    : null;
}

/**
 * Part 4, the score card and optional share (FIELD_STUDY §4.3 step 7, §5.1): the practice score in
 * Kerala's announced format against its 60/100 pass mark, per-clip before and after the replay, and
 * the LL quiz score, on C's share-card face. Sharing sends only a link to this study page and a line
 * of text the participant chooses to send: an anonymous study session has no account, so no server
 * card (API-57) is created and no ID or score leaves the phone unless they paste it themselves.
 * Nothing here is a verdict on anyone's driving.
 */
export function ScoreStep({
  sids,
  ll,
  onNext,
}: {
  sids: { test?: string; fresh?: string };
  ll: { raw: number; max: number } | null;
  onNext: () => void;
}) {
  const t = useTranslations("study");
  const tn = useTranslations("nazar");
  const locale = useLocale();
  const [score, setScore] = useState<StudyScore | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [test, fresh] = await Promise.all([readChecked(sids.test), readChecked(sids.fresh)]);
      if (alive) setScore(studyScore({ test, fresh, ll }));
    };
    void load();
    // A queued run is scored when it syncs: refresh in place.
    let unsub: (() => void) | undefined;
    void import("@/features/games/results-store").then((m) => {
      if (alive) unsub = m.subscribeSessionRecords(() => void load());
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [sids.test, sids.fresh, ll]);

  if (!score) return <StudyLoading />;

  const share = async () => {
    const url = `${window.location.origin}/${locale}/nazar`;
    const text = t("score.shareText", { score: score.hpt ?? 0 });
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    try {
      if (nav.share) await nav.share({ title: t("brand"), text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setCopied(true);
      }
    } catch {
      // the participant closed the share sheet
    }
  };

  return (
    <section className="st-card" aria-labelledby="score-h" data-testid="study-score">
      <h2 id="score-h" className="md-h2">
        {t("score.h1")}
      </h2>
      {score.hpt === null ? (
        <p data-testid="score-pending">{t("score.pending")}</p>
      ) : (
        <>
          <ShareCardView
            content={{
              display_name: t("score.anon"),
              nazar_score: score.hpt,
              counted_sessions: 0,
              rank: "gali",
              kerala_line: false,
              percentile: null,
              calibration: null,
            }}
            labels={{
              brand: t("score.brand"),
              scoreLabel: t("score.scoreLabel"),
              counted: t("score.format"),
              rank: null,
              badge: null,
              tagline: t("score.tagline"),
              challenge: t("score.challenge"),
              keralaLine: null,
              percentile: null,
              footer: t("score.cardFooter"),
              aiScenes: tn("ai.shareCard"),
            }}
          />
          <p data-testid="score-pass-line">
            {score.belowPass ? t("score.below") : t("score.atOrAbove")}
          </p>
        </>
      )}
      {score.preMean !== null && score.postMean !== null ? (
        <p data-testid="score-prepost">
          {t("score.prepost", { pre: score.preMean.toFixed(1), post: score.postMean.toFixed(1) })}
        </p>
      ) : null}
      {score.ll ? (
        <p data-testid="score-ll">{t("score.ll", { raw: score.ll.raw, max: score.ll.max })}</p>
      ) : null}
      {score.provisional ? (
        <p className="st-hint" data-testid="score-provisional">
          {t("score.provisional")}
        </p>
      ) : null}
      <p className="st-hint">{t("score.practiceOnly")}</p>
      {score.hpt !== null ? (
        <>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            onPress={() => void share()}
            data-testid="score-share"
          >
            {t("score.share")}
          </Button>
          <p className="st-hint">{t("score.shareNote")}</p>
          {copied ? <p role="status">{t("score.copied")}</p> : null}
        </>
      ) : null}
      <Button variant="primary" size="lg" fullWidth onPress={onNext} data-testid="score-next">
        {t("score.next")}
      </Button>
    </section>
  );
}
