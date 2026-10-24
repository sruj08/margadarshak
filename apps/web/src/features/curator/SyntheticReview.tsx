"use client";

import { Button } from "@margdarshak/ui/components/button";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { findPii } from "@/lib/redact/redact";
import { recordSyntheticReview, type Source } from "./api";
import { FrameScrubber } from "./FrameScrubber";
import { useProblemText } from "./problem";
import { isAi } from "./rules";
import { type Clip, SYNTHETIC_CHECKS, type SyntheticCheck } from "./types";
import { newKey } from "./use-clip";

const NOT_REVIEWABLE = new Set(["raw", "transcoded", "published", "retired"]);

const allFalse = (): Record<SyntheticCheck, boolean> =>
  Object.fromEntries(SYNTHETIC_CHECKS.map((c) => [c, false])) as Record<SyntheticCheck, boolean>;

/**
 * Synthetic review of an AI-generated clip (product decision 2026-10-24): replaces the blur audit.
 * A reviewer watches the clip and ticks each check (nothing pre-ticked): no real-person likeness, no
 * readable plates, no real brands, no collision or injury, and the hazard visible. Publish needs every
 * check, the reviewer's pseudonym and the time (both set by the server). Two raters and agreement are
 * still required separately.
 */
export function SyntheticReview({
  clip,
  onSaved,
}: {
  clip: Clip;
  onSaved: (clip: Clip, source: Source) => void;
}) {
  const t = useTranslations("curator");
  const problem = useProblemText();
  const id = useId();
  const [frame, setFrame] = useState(0);
  const [checks, setChecks] = useState<Record<SyntheticCheck, boolean>>(allFalse);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = useRef(newKey());

  if (!isAi(clip)) {
    return (
      <p className="cu-note" data-testid="review-filmed">
        {t("review.filmed")}
      </p>
    );
  }
  if (NOT_REVIEWABLE.has(clip.status) || !clip.duration_ms) {
    return (
      <p className="cu-note" data-testid="review-closed">
        {t("review.closed", { status: t(`status.${clip.status}`) })}
      </p>
    );
  }

  const r = clip.synthetic_review;
  const when = (iso: string) => iso.replace("T", " ").slice(0, 16);

  const save = async () => {
    setErr(null);
    if (note.trim() && findPii(note).length > 0) {
      setErr(t("problem.PROHIBITED_FIELD"));
      return;
    }
    setBusy(true);
    try {
      const res = await recordSyntheticReview(
        clip.clip_id,
        { version: clip.version, checks, ...(note.trim() ? { note: note.trim() } : {}) },
        key.current,
      );
      key.current = newKey();
      onSaved(res.data, res.source);
    } catch (e) {
      setErr(problem(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="review-h" data-testid="synthetic-review">
      <h2 id="review-h" className="md-sr-only">
        {t("review.save")}
      </h2>
      <p className="cu-lead">{t("review.lead")}</p>
      {r ? (
        <p
          role="status"
          className={r.passed ? "cu-ok" : "cu-note"}
          data-testid="review-current"
          data-passed={r.passed}
        >
          {r.passed
            ? t("review.passed", { reviewer: r.reviewer, time: when(r.reviewed_at) })
            : t("review.current", {
                reviewer: r.reviewer,
                time: when(r.reviewed_at),
                state: t("review.stateFailed"),
              })}
        </p>
      ) : null}
      <FrameScrubber
        durationMs={clip.duration_ms}
        mediaUrl={clip.media_url}
        placeholder={!clip.media_url}
        frame={frame}
        onFrame={setFrame}
      />
      <fieldset className="cu-fieldset">
        <legend className="cu-label">{t("publish.checks")}</legend>
        {SYNTHETIC_CHECKS.map((c) => (
          <label key={c} className="cu-choice">
            <input
              type="checkbox"
              checked={checks[c]}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setChecks((all) => ({ ...all, [c]: v }));
              }}
              data-testid={`review-${c}`}
            />
            <span>{t(`review.check.${c}`)}</span>
          </label>
        ))}
      </fieldset>
      <label className="cu-field" htmlFor={`${id}-note`}>
        <span className="cu-label">{t("review.note")}</span>
        <input
          id={`${id}-note`}
          className="cu-input"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
      </label>
      {!SYNTHETIC_CHECKS.every((c) => checks[c]) ? (
        <p className="cu-hint">{t("review.failed")}</p>
      ) : null}
      {err ? (
        <p role="alert" className="cu-error">
          {err}
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        isPending={busy}
        onPress={() => void save()}
        data-testid="review-save"
      >
        {t("review.save")}
      </Button>
    </section>
  );
}
