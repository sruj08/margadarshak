"use client";

import { Button } from "@margdarshak/ui/components/button";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  createShareCard,
  getLearnerProfile,
  type LearnerProfileInfo,
  type ShareCreateOutcome,
} from "@/features/games/api";
import { type BadgeKey, SHARE_DISPLAY_NAME_MAX, type ShareCard } from "@/features/games/api-types";
import { useOnline } from "@/features/games/host/online";
import { listSessionRecords } from "@/features/games/results-store";
import { OfflineNote, StateEmpty, StateError, StateLoading } from "@/features/games/states";
import { cardLabels, type GamesT } from "./card-labels";
import { ParentConsentGate } from "./ParentConsentGate";
import { ShareCardView } from "./ShareCardView";
import { previewContent, profileFor, shareDecision, shareDisplayName } from "./share-rules";

/** The latest server-checked Nazar Score on this phone (API-35 `nazar_score`); never a device one. */
export function latestNazarScore(): { score: number; counted: number } | null {
  for (const r of listSessionRecords("nazar")) {
    const s = r.checked?.server_checked ? r.checked.nazar_score : undefined;
    if (s && s.score !== null && s.mocks_counted > 0)
      return { score: s.score, counted: s.mocks_counted };
  }
  return null;
}

function earnedBadges(): BadgeKey[] {
  const out = new Set<BadgeKey>();
  for (const r of listSessionRecords())
    if (r.checked?.server_checked) for (const b of r.checked.badges_awarded ?? []) out.add(b);
  return [...out];
}

/**
 * Share preview (UI_SPEC_LEARN_GAMES §7.5): choose name or initials and one earned badge, see the
 * card, then create it (API-57 delta). The server recomputes every number. A minor's profile needs
 * the parent's `share_cards` consent (ParentConsentGate); an anonymous session needs an account;
 * sharing earns nothing and unlocks nothing.
 */
export function SharePreview() {
  const t = useTranslations("games");
  const member = useSearchParams().get("member");
  const [info, setInfo] = useState<LearnerProfileInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [score, setScore] = useState<{ score: number; counted: number } | null>(null);
  const [badges, setBadges] = useState<BadgeKey[]>([]);

  const load = useCallback(() => {
    setFailed(false);
    setInfo(null);
    getLearnerProfile()
      .then(setInfo)
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
    setScore(latestNazarScore());
    setBadges(earnedBadges());
  }, [load]);

  const decision = info ? shareDecision(profileFor(info, member)) : null;
  const memberName = info?.members.find((m) => m.member_id === member)?.label ?? null;
  const blocked = decision && !decision.allowed ? decision.reason : null;

  return (
    <div className="md-page mg-page" data-screen="SHARE" data-testid="share-preview">
      <OfflineNote>{t("share.offline")}</OfflineNote>
      <h1 className="md-h1">{t("share.title")}</h1>
      {failed ? <StateError onRetry={load} /> : null}
      {!info && !failed ? <StateLoading /> : null}
      {blocked === "needs_parent_consent" ? <ParentConsentGate name={memberName} /> : null}
      {blocked === "needs_account" ? (
        <StateEmpty
          title={t("share.needsAccount")}
          line={t("share.needsAccountLine")}
          href="/signin"
          cta={t("share.signIn")}
        />
      ) : null}
      {decision?.allowed && !score ? (
        <StateEmpty
          title={t("share.ineligible")}
          line={t("share.ineligibleLine")}
          href="/learn/practise/nazar?mode=mock"
          cta={t("share.takeMock")}
        />
      ) : null}
      {decision?.allowed && score ? (
        <ShareForm score={score} badges={badges} member={member} />
      ) : null}
      <p className="mg-note mg-note--ink">{t("share.noXp")}</p>
    </div>
  );
}

/** The line shown when the server did not make the card. */
function outcomeKey(o: Exclude<ShareCreateOutcome, { status: "created" }>) {
  switch (o.status) {
    case "needs_parent_consent":
      return "share.consentLine" as const;
    case "needs_account":
      return "share.needsAccount" as const;
    case "not_allowed":
      return "share.notAllowed" as const;
    default:
      return "states.errorTitle" as const;
  }
}

function ShareForm({
  score,
  badges,
  member,
}: {
  score: { score: number; counted: number };
  badges: readonly BadgeKey[];
  member: string | null;
}) {
  const t = useTranslations("games");
  const tg = t as unknown as GamesT;
  const tn = useTranslations("nazar");
  const locale = useLocale() === "hi" ? "hi" : "en";
  const online = useOnline();
  const id = useId();
  const [name, setName] = useState("");
  const [nameMode, setNameMode] = useState<"display_name" | "initials">("initials");
  const [badge, setBadge] = useState<BadgeKey | null>(null);
  const [kerala, setKerala] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ShareCreateOutcome | null>(null);
  const content = useMemo(
    () =>
      previewContent({
        displayName: name || "—",
        nameMode,
        nazarScore: score.score,
        countedSessions: score.counted,
        badge,
        keralaLine: kerala,
      }),
    [score, name, nameMode, badge, kerala],
  );

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      setOutcome(
        await createShareCard({
          kind: "nazar",
          name_display: nameMode,
          // display_name mode: the server keeps at most 20 characters (422 beyond); initials mode
          // sends the name and the server stores only its initials.
          display_name: nameMode === "display_name" ? shareDisplayName(name) : name.trim(),
          ...(badge ? { badge_id: badge } : {}),
          kerala_line: kerala,
          show_percentile: false,
          locale,
          ...(member ? { family_member_id: member } : {}),
        }),
      );
    } catch {
      setOutcome({ status: "unavailable" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ShareCardView
        content={content}
        labels={cardLabels(tg, content, { showRank: false, aiScenes: tn("ai.shareCard") })}
      />
      <p className="mg-note mg-note--ink">{t("share.serverNote")}</p>
      <div className="mg-fieldset">
        <label className="mg-field" htmlFor={`${id}-name`}>
          <span className="mg-choice__label">{t("share.nameLabel")}</span>
          <input
            id={`${id}-name`}
            className="mg-input"
            value={name}
            maxLength={nameMode === "display_name" ? SHARE_DISPLAY_NAME_MAX : 24}
            autoComplete="given-name"
            onChange={(e) => setName(e.currentTarget.value)}
            data-testid="share-name"
          />
        </label>
        <fieldset className="mg-fieldset">
          <legend className="mg-choice__label">{t("share.name")}</legend>
          {(["initials", "display_name"] as const).map((m) => (
            <label key={m} className="mg-choice">
              <input
                type="radio"
                name={`${id}-mode`}
                checked={nameMode === m}
                onChange={() => setNameMode(m)}
              />
              <span className="mg-choice__label">
                {m === "initials" ? t("share.initials") : t("share.first")}
              </span>
            </label>
          ))}
        </fieldset>
        {badges.length > 0 ? (
          <fieldset className="mg-fieldset">
            <legend className="mg-choice__label">{t("share.badgeLabel")}</legend>
            {[null, ...badges].map((b) => (
              <label key={b ?? "none"} className="mg-choice">
                <input
                  type="radio"
                  name={`${id}-badge`}
                  checked={badge === b}
                  onChange={() => setBadge(b)}
                />
                <span className="mg-choice__label">
                  {b ? t(`share.badge.${b}` as "share.badge.calibrated") : t("share.noBadge")}
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <label className="mg-choice">
          <input
            type="checkbox"
            checked={kerala}
            onChange={(e) => setKerala(e.currentTarget.checked)}
          />
          <span className="mg-choice__label">{t("share.keralaToggle")}</span>
        </label>
        <p className="mg-note mg-note--ink">{t("share.percentileNote")}</p>
      </div>
      {outcome?.status === "created" ? (
        <Created card={outcome.card} />
      ) : (
        <Button
          variant="primary"
          size="lg"
          isDisabled={!online || !name.trim()}
          isPending={busy}
          onPress={() => void create()}
          data-testid="share-create"
        >
          {t("share.create")}
        </Button>
      )}
      {outcome && outcome.status !== "created" ? (
        <p role="status" className="mg-callout" data-testid="share-outcome">
          {t(outcomeKey(outcome))}
        </p>
      ) : null}
    </>
  );
}

function Created({ card }: { card: ShareCard }) {
  const t = useTranslations("games");
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    try {
      if (nav.share) await nav.share({ url: card.url, title: t("share.title") });
      else {
        await navigator.clipboard.writeText(card.url);
        setCopied(true);
      }
    } catch {
      // the learner closed the share sheet
    }
  };
  return (
    <div className="mg-sheet-actions" data-testid="share-created">
      <p>{t("share.created")}</p>
      <Button variant="primary" size="lg" onPress={() => void share()}>
        {t("share.share")}
      </Button>
      <a className="md-link" href={card.url}>
        {card.url}
      </a>
      {copied ? <p role="status">{t("share.copied")}</p> : null}
    </div>
  );
}
