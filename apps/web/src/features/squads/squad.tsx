"use client";

import { featureAccess } from "@margdarshak/gamification";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import {
  getMySquads,
  isNoAccount,
  isOffline,
  LEARN_API_MODE,
  LearnApiError,
  leaveSquad,
} from "@/features/learn/api";
import type { Squad as SquadT } from "@/features/learn/api-types";
import { type LearnerProfile, learnerProfile } from "@/features/learn/profile";
import { ErrorState, LoadingState, OfflineBanner } from "@/features/learn/ui/states";
import { Link } from "@/i18n/navigation";
import { forgetInvite, inviteToken, rememberedInvite } from "./invite";
import { ParentConsentStep } from "./parent-consent-step";

/**
 * Squad (UI_SPEC_LEARN_GAMES §7.4, GAMIFICATION_ENGINE §8): 3–5 friends, co-op only. One shared score;
 * members see each other's display name, rank and "done this week" yes/no, never anyone's score, so
 * there is no leaderboard against named people. Leaving is one tap and the squad is not told why.
 * A minor's profile sees the parent-consent step first.
 */

export function Initials({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="ml-node__glyph font-semibold" aria-hidden="true">
      {letters}
    </span>
  );
}

export function SquadCard({ squad, onLeave }: { squad: SquadT; onLeave?: () => void }) {
  const t = useTranslations("me.squad");
  const tr = useTranslations("me.ranks");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const spots = Math.max(0, 5 - squad.members.length);
  // Only the create response carries the code; afterwards this phone's copy (if it made the squad).
  const code =
    squad.invite_code ?? (typeof window !== "undefined" ? rememberedInvite(squad.squad_id) : null);
  const link =
    code && typeof window !== "undefined"
      ? `${window.location.origin}/${locale}/s/${inviteToken(squad.squad_id, code)}`
      : null;

  const share = async () => {
    if (!link) return;
    try {
      if (navigator.share) await navigator.share({ title: squad.name, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      }
    } catch {
      // share sheet dismissed
    }
  };

  return (
    <section className="ml-card" aria-labelledby="sq-name" data-testid="squad-card">
      <h2 id="sq-name" className="md-h2">
        {squad.name}
      </h2>
      <p className="md-h3">
        {squad.squad_score === null ? t("scorePending") : t("score", { s: squad.squad_score })}
      </p>
      <p>{t("goal", { n: squad.weekly_progress.goal })}</p>
      <div className="ml-bar" aria-hidden="true">
        <span
          style={{
            width: `${Math.min(100, Math.round((squad.weekly_progress.done / Math.max(1, squad.weekly_progress.goal)) * 100))}%`,
          }}
        />
      </div>
      <p className="ml-small">
        {t("progress", { d: squad.weekly_progress.done, n: squad.weekly_progress.goal })}
      </p>
      {squad.members.length < 3 ? <p>{t("forming", { k: 3 - squad.members.length })}</p> : null}
      <h3 className="md-h3">{t("members")}</h3>
      <ul className="ml-list">
        {squad.members.map((m) => (
          <li key={`${m.display_name}-${m.role}`} className="ml-row">
            <Initials name={m.display_name} />
            <span className="font-semibold">
              {m.display_name}
              {m.is_me ? ` (${t("you")})` : ""}
            </span>
            <span className="ml-small">{tr(m.rank)}</span>
            <span>{m.weekly_goal_hit ? `✓ ${t("done")}` : `○ ${t("notYet")}`}</span>
          </li>
        ))}
      </ul>
      <p className="ml-small">{t("how")}</p>
      {link && spots > 0 ? (
        <button
          type="button"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          onClick={() => void share()}
        >
          {t("invite", { k: spots })}
        </button>
      ) : null}
      {copied ? (
        <p role="status" className="ml-small">
          {t("copied")}
        </p>
      ) : null}
      {onLeave ? (
        <button type="button" className="ml-link-btn" onClick={onLeave}>
          {t("leave")}
        </button>
      ) : null}
    </section>
  );
}

export function SquadScreen() {
  const t = useTranslations("me.squad");
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [squads, setSquads] = useState<SquadT[] | null>(null);
  const [error, setError] = useState<"offline" | "consent" | "account" | "other" | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const p = learnerProfile();
    setProfile(p);
    if (!featureAccess(p, "squads").allowed) return;
    try {
      setSquads((await getMySquads(p, Date.now())).data);
    } catch (e) {
      if (e instanceof LearnApiError && e.code === "PARENT_CONSENT_REQUIRED") setError("consent");
      else if (isNoAccount(e)) setError("account");
      else setError(isOffline(e) ? "offline" : "other");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!profile) return <LoadingState rows={2} />;
  if (!featureAccess(profile, "squads").allowed || error === "consent")
    return <ParentConsentStep profile={profile} onDone={() => void load()} />;
  if (error === "account")
    return (
      <div className="ml-card">
        <p>{t("needAccount")}</p>
        <Link href="/signin" className={buttonClassName({ variant: "primary", size: "lg" })}>
          {t("signIn")}
        </Link>
      </div>
    );
  if (error === "other") return <ErrorState onRetry={() => void load()} />;
  if (error === "offline")
    return (
      <div className="md-stack">
        <OfflineBanner />
        <p>{t("offline")}</p>
      </div>
    );
  if (!squads) return <LoadingState rows={3} />;

  return (
    <div className="md-stack" data-screen="LRN-033" data-testid="squad-screen">
      <OfflineBanner />
      {LEARN_API_MODE === "mock" ? <p className="ml-chip">{t("simulated")}</p> : null}
      {squads.length === 0 ? (
        <div className="ml-card" data-testid="squad-empty">
          <h2 className="md-h2">{t("emptyTitle")}</h2>
          <p>{t("emptyLine")}</p>
          <Link
            href="/learn/me/squad/new"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          >
            {t("create")}
          </Link>
          <p className="ml-small">{t("haveLink")}</p>
        </div>
      ) : (
        squads.map((s) => (
          <SquadCard
            key={s.squad_id}
            squad={s}
            onLeave={() => {
              void leaveSquad(s.squad_id, profile)
                .then(() => {
                  forgetInvite(s.squad_id);
                  setSquads((prev) => (prev ?? []).filter((x) => x.squad_id !== s.squad_id));
                })
                .catch(() => setError("offline"));
            }}
          />
        ))
      )}
    </div>
  );
}
