"use client";

import { Button } from "@margdarshak/ui/components/button";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { hazardLabel } from "@/features/nazar/hazard-labels";
import { type CommentaryResult, scoreCommentary } from "./api";

/**
 * Commentary mode, record then score (MD-310, D-12): the learner talks over the clip while it
 * replays; after Stop the audio is uploaded once, transcribed and matched against the hazard
 * windows in code, then deleted. Never live. The Kerala score is untouched. Only a server-checked
 * session can be scored (`enabled`): the windows live on the server.
 */
export function CommentaryRecorder({
  sid,
  ordinal,
  enabled,
}: {
  sid: string;
  ordinal: number;
  enabled: boolean;
}) {
  if (!enabled) return null;
  return <Recorder sid={sid} ordinal={ordinal} />;
}

function Recorder({ sid, ordinal }: { sid: string; ordinal: number }) {
  const t = useTranslations("ai.commentary");
  const locale = useLocale();
  const [phase, setPhase] = useState<"idle" | "recording" | "scoring">("idle");
  const [result, setResult] = useState<CommentaryResult | null>(null);
  const [notice, setNotice] = useState<"off" | "consentNeeded" | null>(null);
  const rec = useRef<MediaRecorder | null>(null);

  const start = async () => {
    setResult(null);
    setNotice(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia)
      return setNotice("off");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setNotice("off");
    }
    const r = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    r.onstop = () => {
      for (const tr of stream.getTracks()) tr.stop();
      setPhase("scoring");
      const lang = locale === "hi" ? "hi" : "en";
      void scoreCommentary(
        sid,
        ordinal,
        new Blob(chunks, { type: r.mimeType || "audio/webm" }),
        lang,
      ).then((res) => {
        setPhase("idle");
        if (res.ok) return setResult(res.data);
        setNotice(res.code === "CONSENT_REQUIRED" ? "consentNeeded" : "off");
      });
    };
    rec.current = r;
    r.start();
    setPhase("recording");
    // One clip is under a minute; a longer recording is cut so the upload stays under 2 MB.
    setTimeout(() => r.state === "recording" && r.stop(), 60_000);
  };

  const hit = result?.hazards.filter((h) => h.hit).length ?? 0;
  return (
    <section className="mj-card" aria-labelledby="commentary-h" data-testid="commentary">
      <h2 id="commentary-h" className="md-h3">
        {t("title")}
      </h2>
      <p className="mj-caption">{t("consent")}</p>
      <Button
        variant={phase === "recording" ? "danger" : "secondary"}
        isPending={phase === "scoring"}
        onPress={() => (phase === "recording" ? rec.current?.stop() : void start())}
        data-testid="commentary-record"
      >
        {phase === "recording" ? t("stop") : t("start")}
      </Button>
      {phase === "scoring" ? <p role="status">{t("working")}</p> : null}
      {notice ? <p role="status">{t(notice)}</p> : null}
      {result ? (
        <div role="status" data-testid="commentary-result">
          <p>{t("score", { hit, total: result.hazards.length })}</p>
          <ul>
            {result.hazards.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: hazards come in clip order, never reorder, and a type can repeat
              <li key={`${h.hazard_type}-${i}`}>
                {hazardLabel(h.hazard_type, locale)}: {h.hit ? t("hit") : t("missed")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
