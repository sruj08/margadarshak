"use client";

import { Button } from "@margdarshak/ui/components/button";
import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { adjudicateClip, type Source } from "./api";
import { FrameScrubber, type ScrubBand } from "./FrameScrubber";
import { HAZARD_OPTIONS, hazardLabel } from "./hazards";
import { useProblemText } from "./problem";
import { RatingCard } from "./RaterForm";
import {
  type AdjudicationIssue,
  adjudicationIssues,
  clockTime,
  parseSeconds,
  secondsText,
  snapMs,
} from "./rules";
import {
  ADJ_REASONS,
  type AdjReason,
  type AgreementCluster,
  type Clip,
  type ClipAdjudicationCreate,
  type HazardType,
} from "./types";
import { newKey } from "./use-clip";

interface Ruling {
  verdict: "hazard" | "not_hazard" | null;
  hazard_type: HazardType;
  a: string;
  b: string;
}

function initialRuling(c: AgreementCluster): Ruling {
  const marks = c.marks.map((m) => m.mark);
  const mean = (f: (m: (typeof marks)[number]) => number) =>
    marks.length ? snapMs(marks.reduce((s, m) => s + f(m), 0) / marks.length) : 0;
  return {
    verdict: null,
    hazard_type: marks[0]?.hazard_type ?? "other",
    a: secondsText(mean((m) => m.a_ms)),
    b: secondsText(mean((m) => m.b_ms)),
  };
}

/**
 * Adjudication (NAZAR §6.4, UI_SPEC_LEARN_GAMES §12.4): shown only for a clip in `adjudication`,
 * which is after both raters saved, so both ratings (and any AI proposal, labelled as not used for
 * scoring) are visible here. The adjudicator must not be one of the raters and rules on every
 * cluster; a hazard needs the adjudicator's own mark.
 */
export function Adjudicate({
  clip,
  viewer,
  onSaved,
}: {
  clip: Clip;
  viewer: string | null;
  onSaved: (clip: Clip, source: Source) => void;
}) {
  const t = useTranslations("curator");
  const locale = useLocale();
  const problem = useProblemText();
  const id = useId();
  const agreement = clip.agreement;
  const [frame, setFrame] = useState(0);
  const [rulings, setRulings] = useState<Record<string, Ruling>>(() =>
    Object.fromEntries((agreement?.clusters ?? []).map((c) => [c.cluster_id, initialRuling(c)])),
  );
  const [reason, setReason] = useState<AdjReason>("window_resolved");
  const [issues, setIssues] = useState<AdjudicationIssue[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const key = useRef(newKey());

  if (clip.status !== "adjudication" || !agreement || !clip.ratings_visible) {
    return (
      <>
        {done ? (
          <p role="status" className="cu-ok" data-testid="adjudicate-done">
            {t("adjudicate.done")}
          </p>
        ) : (
          <p className="cu-note" data-testid="adjudicate-closed">
            {t("adjudicate.notOpen", { status: t(`status.${clip.status}`) })}
          </p>
        )}
      </>
    );
  }
  const isRater = !!viewer && (clip.ratings ?? []).some((r) => r.rater === viewer);
  const raterA = agreement.raters[0] ?? "A";

  const bands: ScrubBand[] = [
    ...agreement.clusters.flatMap((c) =>
      c.marks.map((m, i) => ({
        key: `${c.cluster_id}-${i}`,
        aMs: m.mark.a_ms,
        bMs: m.mark.b_ms,
        label: `${c.cluster_id} · ${m.rater}`,
        tone: (m.rater === raterA ? "a" : "b") as "a" | "b",
      })),
    ),
    ...(clip.proposals ?? []).map((p, i) => ({
      key: `ai-${i}`,
      aMs: p.a_ms,
      bMs: p.b_ms,
      label: t("rate.proposals"),
      tone: "ai" as const,
    })),
  ];

  const body = (): ClipAdjudicationCreate => ({
    version: clip.version,
    reason_code: reason,
    decisions: agreement.clusters.flatMap((c): ClipAdjudicationCreate["decisions"] => {
      const r = rulings[c.cluster_id];
      if (!r?.verdict) return [];
      if (r.verdict === "not_hazard")
        return [{ cluster_id: c.cluster_id, verdict: "not_hazard" as const }];
      const a = parseSeconds(r.a);
      const b = parseSeconds(r.b);
      return [
        {
          cluster_id: c.cluster_id,
          verdict: "hazard" as const,
          ...(a !== null && b !== null
            ? { mark: { hazard_type: r.hazard_type, a_ms: a, b_ms: b } }
            : {}),
        },
      ];
    }),
  });

  const save = async () => {
    const input = body();
    const found = adjudicationIssues(agreement, input, clip.duration_ms ?? 0);
    setIssues(found);
    setErr(null);
    if (found.length > 0) return;
    setBusy(true);
    try {
      const r = await adjudicateClip(clip.clip_id, input, key.current);
      setDone(true);
      onSaved(r.data, r.source);
    } catch (e) {
      setErr(problem(e));
    } finally {
      setBusy(false);
    }
  };

  const set = (cid: string, patch: Partial<Ruling>) =>
    setRulings((all) => ({ ...all, [cid]: { ...(all[cid] as Ruling), ...patch } }));

  return (
    <section aria-labelledby="adj-h" data-testid="adjudicate">
      <h2 id="adj-h" className="md-sr-only">
        {t("adjudicate.save")}
      </h2>
      <p className="cu-lead">{t("adjudicate.lead")}</p>
      {isRater ? (
        <p className="cu-error" role="alert" data-testid="adjudicate-is-rater">
          {t("adjudicate.isRater")}
        </p>
      ) : null}
      <ul className="cu-ratings">
        {(clip.ratings ?? []).map((r) => (
          <RatingCard key={r.rating_id} rating={r} />
        ))}
      </ul>
      <FrameScrubber
        durationMs={clip.duration_ms ?? 0}
        mediaUrl={clip.media_url}
        placeholder={!clip.media_url}
        frame={frame}
        onFrame={setFrame}
        bands={bands}
      />
      <ol className="cu-marks">
        {agreement.clusters.map((c) => {
          const r = rulings[c.cluster_id] as Ruling;
          return (
            <li key={c.cluster_id} className="cu-mark" data-testid={`cluster-${c.cluster_id}`}>
              <h3 className="md-h3">
                {t("adjudicate.cluster", { id: c.cluster_id })} · {t(`adjudicate.kind.${c.kind}`)}
              </h3>
              <ul className="cu-list">
                {c.marks.map((m) => (
                  <li key={m.rater}>
                    {m.rater}: {hazardLabel(m.mark.hazard_type, locale)} · {clockTime(m.mark.a_ms)}{" "}
                    – {clockTime(m.mark.b_ms)}
                  </li>
                ))}
              </ul>
              <fieldset className="cu-fieldset">
                <legend className="cu-label">{t("adjudicate.verdict")}</legend>
                {(["hazard", "not_hazard"] as const).map((v) => (
                  <label key={v} className="cu-choice">
                    <input
                      type="radio"
                      name={`${id}-${c.cluster_id}`}
                      checked={r.verdict === v}
                      onChange={() => set(c.cluster_id, { verdict: v })}
                      data-testid={`cluster-${c.cluster_id}-${v}`}
                    />
                    <span>
                      {v === "hazard" ? t("adjudicate.isHazard") : t("adjudicate.notHazard")}
                    </span>
                  </label>
                ))}
              </fieldset>
              {r.verdict === "hazard" ? (
                <>
                  <label className="cu-field">
                    <span className="cu-label">{t("rate.type")}</span>
                    <select
                      className="cu-select"
                      value={r.hazard_type}
                      onChange={(e) =>
                        set(c.cluster_id, { hazard_type: e.currentTarget.value as HazardType })
                      }
                    >
                      {HAZARD_OPTIONS.map((h) => (
                        <option key={h} value={h}>
                          {hazardLabel(h, locale)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="cu-pair">
                    <label className="cu-field">
                      <span className="cu-label">{t("rate.onset")}</span>
                      <input
                        className="cu-input"
                        inputMode="decimal"
                        value={r.a}
                        onChange={(e) => set(c.cluster_id, { a: e.currentTarget.value })}
                      />
                    </label>
                    <label className="cu-field">
                      <span className="cu-label">{t("rate.end")}</span>
                      <input
                        className="cu-input"
                        inputMode="decimal"
                        value={r.b}
                        onChange={(e) => set(c.cluster_id, { b: e.currentTarget.value })}
                      />
                    </label>
                  </div>
                </>
              ) : null}
            </li>
          );
        })}
      </ol>
      <label className="cu-field" htmlFor={`${id}-reason`}>
        <span className="cu-label">{t("adjudicate.reason")}</span>
        <select
          id={`${id}-reason`}
          className="cu-select"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value as AdjReason)}
        >
          {ADJ_REASONS.map((x) => (
            <option key={x} value={x}>
              {t(`adjudicate.reasons.${x}`)}
            </option>
          ))}
        </select>
      </label>
      {issues.length > 0 ? (
        <ul className="cu-error" role="alert">
          {issues.map((i) => (
            <li key={i}>{t(`adjudicate.issues.${i}`)}</li>
          ))}
        </ul>
      ) : null}
      {err ? (
        <p role="alert" className="cu-error" data-testid="adjudicate-error">
          {err}
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        isPending={busy}
        isDisabled={isRater}
        onPress={() => void save()}
        data-testid="adjudicate-save"
      >
        {t("adjudicate.save")}
      </Button>
    </section>
  );
}
