"use client";

import { featureAccess } from "@margdarshak/gamification";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { isOffline, joinSquad, LearnApiError } from "@/features/learn/api";
import type { Squad } from "@/features/learn/api-types";
import { type LearnerProfile, learnerProfile } from "@/features/learn/profile";
import { LoadingState, OfflineBanner } from "@/features/learn/ui/states";
import { Link } from "@/i18n/navigation";
import { nameProblem, parseInvite } from "./invite";
import { ParentConsentStep } from "./parent-consent-step";
import { SquadCard } from "./squad";

/**
 * Join a squad from an invite link (`/s/[inviteToken]`, API-39 joinSquad). A minor's profile sees the
 * parent-consent step first and cannot join without it (gamification `canJoinSquad`, server 403
 * PARENT_CONSENT_REQUIRED). Full squads and expired links get a plain sentence, not an alarm.
 */
export function Join({ token }: { token: string }) {
  const t = useTranslations("me.squad");
  const id = useId();
  const invite = parseInvite(token);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [display, setDisplay] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [joined, setJoined] = useState<Squad | null>(null);

  useEffect(() => setProfile(learnerProfile()), []);

  if (!invite)
    return (
      <div className="ml-card" data-testid="join-invalid">
        <p className="md-h3">{t("badLink")}</p>
        <Link href="/learn/me/squad" className="md-link">
          {t("toSquads")}
        </Link>
      </div>
    );
  if (!profile) return <LoadingState rows={2} />;
  if (!featureAccess(profile, "squads").allowed)
    return <ParentConsentStep profile={profile} onDone={() => setProfile(learnerProfile())} />;
  if (joined)
    return (
      <div className="md-stack">
        <p className="ml-chip" role="status">
          {t("joined")}
        </p>
        <SquadCard squad={joined} />
        <Link href="/learn/me/squad" className="md-link">
          {t("toSquads")}
        </Link>
      </div>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = nameProblem(display, 24);
    if (p) {
      setProblem(t(`name_${p}`));
      return;
    }
    try {
      setJoined(
        (
          await joinSquad(
            invite.squadId,
            { invite_code: invite.code, display_name: display },
            profile,
            Date.now(),
          )
        ).data,
      );
    } catch (err) {
      if (err instanceof LearnApiError) {
        if (err.code === "PARENT_CONSENT_REQUIRED") {
          setProfile(learnerProfile());
          setProblem(t("needConsent"));
        } else if (err.code === "SQUAD_FULL") setProblem(t("full"));
        else if (err.code === "INVITE_EXPIRED") setProblem(t("expired"));
        else if (err.status === 401) setProblem(t("needAccount"));
        else setProblem(t("badLink"));
      } else setProblem(isOffline(err) ? t("offline") : t("createError"));
    }
  };

  return (
    <form className="md-stack" onSubmit={(e) => void submit(e)} data-testid="join-squad">
      <OfflineBanner />
      <p>{t("joinLine")}</p>
      <label htmlFor={`${id}-d`} className="font-semibold">
        {t("displayLabel")}
      </label>
      <input
        id={`${id}-d`}
        className="ml-input"
        value={display}
        maxLength={24}
        autoComplete="nickname"
        onChange={(e) => setDisplay(e.target.value)}
      />
      <p className="ml-small">{t("displayHint")}</p>
      {problem ? (
        <p className="ml-feedback" data-tone="warn" role="alert">
          {problem}
        </p>
      ) : null}
      <button
        type="submit"
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
      >
        {t("join")}
      </button>
      <p className="ml-small">{t("how")}</p>
    </form>
  );
}
