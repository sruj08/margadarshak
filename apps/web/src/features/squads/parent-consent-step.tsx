"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { LEARN_API_MODE } from "@/features/learn/api";
import { type LearnerProfile, recordSquadConsent } from "@/features/learn/profile";
import { Link } from "@/i18n/navigation";

/**
 * Parent-consent step for a minor's profile (D-13 revised, GAMIFICATION_ENGINE §13, MD-236). Shown
 * BEFORE anything squad-related. The parent confirms on this phone with a box that starts unticked
 * (DP-06: no pre-ticked consent) and a clear "Not now". With the real API the consent is recorded
 * on the privacy screen (API-60 with the `squads` extra) and the server enforces it (403
 * PARENT_CONSENT_REQUIRED); in mock mode it is recorded on this phone.
 */
export function ParentConsentStep({
  profile,
  onDone,
}: {
  profile: LearnerProfile;
  onDone: () => void;
}) {
  const t = useTranslations("me.consent");
  const id = useId();
  const [checked, setChecked] = useState(false);
  const who = profile.memberLabel ?? t("yourChild");

  return (
    <section className="ml-card" aria-labelledby={`${id}-h`} data-testid="parent-consent">
      <h2 id={`${id}-h`} className="md-h2">
        {t("title")}
      </h2>
      <p>{t("body")}</p>
      <p className="font-semibold">{t("handOver")}</p>
      {LEARN_API_MODE === "real" ? (
        <Link
          href="/privacy"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        >
          {t("openPrivacy")}
        </Link>
      ) : (
        <>
          <label className="ml-opt" htmlFor={`${id}-c`}>
            <input
              id={`${id}-c`}
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>{t("confirm", { who })}</span>
          </label>
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            disabled={!checked}
            onClick={() => {
              recordSquadConsent(profile.memberId, true);
              onDone();
            }}
          >
            {t("allow")}
          </button>
        </>
      )}
      <Link href="/learn/me" className="md-link">
        {t("notNow")}
      </Link>
      <p className="ml-small">{t("rest")}</p>
    </section>
  );
}
