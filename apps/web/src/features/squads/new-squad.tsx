"use client";

import { Description, Button as HeroButton, Input, Label } from "@heroui/react";
import { featureAccess } from "@margdarshak/gamification";
import { Button } from "@margdarshak/ui/components/button";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { createSquad, isNoAccount, isOffline, LearnApiError } from "@/features/learn/api";
import type { Squad } from "@/features/learn/api-types";
import { type LearnerProfile, learnerProfile } from "@/features/learn/profile";
import { LoadingState, OfflineBanner } from "@/features/learn/ui/states";
import { nameProblem, rememberInvite, suggestName } from "./invite";
import { ParentConsentStep } from "./parent-consent-step";
import { SquadCard } from "./squad";

/**
 * Start a squad (UI_SPEC_LEARN_GAMES §7.4, API-39 createSquad). A name is suggested (place + number)
 * so nobody has to type one; a typed name is checked for personal data first. Creating a squad earns
 * no XP (§2.3). After creating, the invite link is shown.
 */
export function NewSquad() {
  const t = useTranslations("me.squad");
  const id = useId();
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [name, setName] = useState("");
  const [display, setDisplay] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<Squad | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProfile(learnerProfile());
    setName(suggestName(Math.floor(Math.random() * 1000)));
  }, []);

  if (!profile) return <LoadingState rows={2} />;
  if (!featureAccess(profile, "squads").allowed)
    return <ParentConsentStep profile={profile} onDone={() => setProfile(learnerProfile())} />;
  if (created) return <SquadCard squad={created} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p1 = nameProblem(name);
    const p2 = nameProblem(display, 24);
    if (p1 || p2) {
      setProblem(t(`name_${p1 ?? p2 ?? "short"}`));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const sq = (await createSquad({ name, display_name: display }, profile, Date.now())).data;
      if (sq.invite_code) rememberInvite(sq.squad_id, sq.invite_code, sq.invite_expires_at);
      setCreated(sq);
    } catch (err) {
      if (err instanceof LearnApiError && err.code === "PARENT_CONSENT_REQUIRED")
        setProfile(learnerProfile());
      setProblem(
        isOffline(err) ? t("offline") : isNoAccount(err) ? t("needAccount") : t("createError"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="md-stack" onSubmit={(e) => void submit(e)} data-testid="new-squad">
      <OfflineBanner />
      <Label htmlFor={`${id}-n`} className="font-semibold">
        {t("nameLabel")}
      </Label>
      <Input
        id={`${id}-n`}
        className="ml-input"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
      />
      <HeroButton
        className="ml-link-btn"
        onPress={() => setName(suggestName(Math.floor(Math.random() * 1000)))}
      >
        {t("another")}
      </HeroButton>
      <Label htmlFor={`${id}-d`} className="font-semibold">
        {t("displayLabel")}
      </Label>
      <Input
        id={`${id}-d`}
        className="ml-input"
        value={display}
        maxLength={24}
        autoComplete="nickname"
        onChange={(e) => setDisplay(e.target.value)}
      />
      <Description className="ml-small">{t("displayHint")}</Description>
      {problem ? (
        <p className="ml-feedback" data-tone="warn" role="alert">
          {problem}
        </p>
      ) : null}
      <Button type="submit" isDisabled={busy} variant="primary" size="lg" fullWidth>
        {t("create")}
      </Button>
    </form>
  );
}
