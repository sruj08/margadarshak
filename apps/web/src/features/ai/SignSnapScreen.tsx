"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { type SignSnapResult, snapSign } from "./api";
import { prepareImage, render } from "./image";

/** About 10 km/h: above it the photo is refused (riding lock, VOICE.md §4.3 PULL_OVER). */
const MOVING_MPS = 2.8;

function movingNow(): Promise<boolean> {
  if (!navigator.geolocation) return Promise.resolve(false);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve((p.coords.speed ?? 0) > MOVING_MPS),
      () => resolve(false),
      { timeout: 1500, maximumAge: 5000 },
    );
  });
}

/**
 * Road Sign Snap (MD-320, API-75). The photo is downscaled on the phone; the server matches it to
 * the sign catalogue and the meaning shown is the catalogue's, never the model's. Low confidence
 * offers up to three choices; an unknown sign says so.
 */
export function SignSnapScreen() {
  const t = useTranslations("ai.snap");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SignSnapResult | null>(null);
  const [notice, setNotice] = useState<"riding" | "consent" | "off" | null>(null);

  const snap = async (file: File | undefined) => {
    if (!file) return;
    setRes(null);
    setNotice(null);
    setBusy(true);
    const p = await prepareImage(file);
    const out = await snapSign(await render(p, []), await movingNow());
    setBusy(false);
    if (out.ok) return setRes(out.data);
    setNotice(
      out.code === "RIDING_LOCKED" ? "riding" : out.code === "CONSENT_REQUIRED" ? "consent" : "off",
    );
  };

  const card = (s: NonNullable<SignSnapResult["sign"]>) => (
    <article
      className="mj-card mj-card--soft"
      key={s.sign_id}
      data-testid="snap-sign"
      data-sign={s.sign_id}
    >
      <h2 className="md-h3">{s.name}</h2>
      <p>{s.meaning}</p>
      {!s.verified ? <p className="mj-caption">{t("unverified")}</p> : null}
    </article>
  );

  return (
    <div className="md-page md-stack" data-testid="snap-screen">
      <h1 className="md-h1">{t("title")}</h1>
      <p>{t("intro")}</p>
      <label className="md-field__label" htmlFor="snap-file">
        {t("take")}
      </label>
      <input
        id="snap-file"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => void snap(e.target.files?.[0])}
        data-testid="snap-file"
      />
      {busy ? <p role="status">{t("working")}</p> : null}
      {notice ? (
        <Banner tone={notice === "riding" ? "caution" : "info"} title={t(notice)} role="status">
          {null}
        </Banner>
      ) : null}
      {res?.status === "match" && res.sign ? (
        <section aria-label={t("match")}>
          <p>{t("match")}</p>
          {card(res.sign)}
        </section>
      ) : null}
      {res?.status === "choose" ? (
        <section aria-label={t("choose")}>
          <p>{t("choose")}</p>
          {res.choices.map(card)}
        </section>
      ) : null}
      {res?.status === "not_in_catalogue" ? <p role="status">{t("none")}</p> : null}
      {res ? (
        <Button variant="secondary" onPress={() => setRes(null)}>
          {t("again")}
        </Button>
      ) : null}
    </div>
  );
}
