"use client";

import { Description, Label, TextArea } from "@heroui/react";
import { Button } from "@margdarshak/ui/components/button";
import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { recordNearMiss, StudyApiError, StudyOffline } from "./api";
import { NEAR_MISS_MAX, type NearMissKind, scanNearMiss } from "./near-miss";

/**
 * Part 5, the optional near-miss line (FIELD_STUDY §4.3 step 8, D-21): at most 140 characters,
 * privacy-scanned on the phone first (src/lib/redact plus vehicle and licence numbers) and sent
 * already masked; the server scans again and refuses what it still finds (422 PROHIBITED_FIELD),
 * storing nothing. Skipping writes nothing.
 */
export function NearMissStep({
  participantCode,
  onDone,
}: {
  participantCode: string;
  onDone: () => void;
}) {
  const t = useTranslations("study");
  const locale = useLocale() === "hi" ? "hi" : "en";
  const id = useId();
  const [text, setText] = useState("");
  const [removed, setRemoved] = useState<NearMissKind[]>([]);
  const [msg, setMsg] = useState<"empty" | "refused" | "offline" | "error" | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());

  const send = async () => {
    const scan = scanNearMiss(text);
    setRemoved(scan.kinds);
    setMsg(null);
    if (!scan.text) {
      setMsg("empty");
      return;
    }
    setText(scan.text);
    setBusy(true);
    try {
      await recordNearMiss(participantCode, { text: scan.text, language: locale }, key.current);
      setSent(true);
    } catch (e) {
      key.current = crypto.randomUUID();
      if (e instanceof StudyApiError && e.status === 422) setMsg("refused");
      else if (e instanceof StudyOffline) setMsg("offline");
      else setMsg("error");
    } finally {
      setBusy(false);
    }
  };

  const kinds = [...new Set(removed.map((k) => t(`nearMiss.kind.${k}`)))].join(", ");

  return (
    <section className="st-card" aria-labelledby="nm-h" data-testid="near-miss">
      <h2 id="nm-h" className="md-h2">
        {t("nearMiss.h1")}
      </h2>
      {sent ? (
        <>
          {removed.length > 0 ? (
            <p className="st-hint" data-testid="near-miss-removed">
              {t("nearMiss.removed", { kinds })}
            </p>
          ) : null}
          <p role="status" data-testid="near-miss-sent">
            {t("nearMiss.sent")}
          </p>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onPress={onDone}
            data-testid="near-miss-done"
          >
            {t("score.next")}
          </Button>
        </>
      ) : (
        <>
          <div className="st-field">
            <Label htmlFor={`${id}-text`} className="st-label">
              {t("nearMiss.label")}
            </Label>
            <TextArea
              id={`${id}-text`}
              className="st-textarea"
              rows={3}
              maxLength={NEAR_MISS_MAX}
              lang={locale}
              value={text}
              aria-describedby={`${id}-hint ${id}-count`}
              onChange={(e) => setText(e.currentTarget.value)}
              data-testid="near-miss-text"
            />
          </div>
          <Description id={`${id}-hint`} className="st-hint">
            {t("nearMiss.hint")}
          </Description>
          <p id={`${id}-count`} className="st-hint" aria-live="polite">
            {t("nearMiss.count", { n: text.length, max: NEAR_MISS_MAX })}
          </p>
          {msg ? (
            <p role="alert" className="st-error" data-testid="near-miss-msg">
              {msg === "empty"
                ? t("nearMiss.empty")
                : msg === "refused"
                  ? t("nearMiss.refused")
                  : msg === "offline"
                    ? t("states.offlineBody")
                    : t("states.errorTitle")}
            </p>
          ) : null}
          <div className="st-actions">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              isPending={busy}
              onPress={() => void send()}
              data-testid="near-miss-send"
            >
              {t("nearMiss.check")}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onPress={onDone}
              data-testid="near-miss-skip"
            >
              {t("nearMiss.skip")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
