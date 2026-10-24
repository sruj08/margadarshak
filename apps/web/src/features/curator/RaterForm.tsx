"use client";

import { Fieldset, Input, Label } from "@heroui/react";
import { Button } from "@margdarshak/ui/components/button";
import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { findPii } from "@/lib/redact/redact";
import { rateClip, type Source } from "./api";
import { FrameScrubber, type ScrubBand } from "./FrameScrubber";
import { HAZARD_OPTIONS, hazardDefinition, hazardLabel } from "./hazards";
import { useProblemText } from "./problem";
import {
  clockTime,
  frameToMs,
  type MarkIssue,
  markIssues,
  myRating,
  parseSeconds,
  secondsText,
  visibleRatings,
} from "./rules";
import type { Clip, ClipAgreement, ClipMark, ClipRating, HazardType } from "./types";
import { newKey } from "./use-clip";

const OPEN_FOR_RATING = new Set(["blurred", "audited", "proposed"]);
const MAX_MARKS = 10;

interface Draft {
  key: number;
  hazard_type: HazardType;
  a: string;
  b: string;
  cue: string;
  occlusion: boolean;
}

function draftToMark(d: Draft): ClipMark | null {
  const a = parseSeconds(d.a);
  const b = parseSeconds(d.b);
  if (a === null || b === null) return null;
  return {
    hazard_type: d.hazard_type,
    a_ms: a,
    b_ms: b,
    ...(d.cue.trim() ? { cue: d.cue.trim() } : {}),
    occlusion: d.occlusion,
  };
}

/** Drafts → marks, with the issues of each draft (an unparseable time counts as out of order). */
function checkDrafts(
  drafts: readonly Draft[],
  duration: number,
): { marks: ClipMark[]; found: Record<number, MarkIssue[]> } {
  const marks: ClipMark[] = [];
  const found: Record<number, MarkIssue[]> = {};
  for (const d of drafts) {
    const m = draftToMark(d);
    const list: MarkIssue[] = m ? markIssues(m, duration, (s) => findPii(s).length > 0) : ["order"];
    if (list.length > 0) found[d.key] = list;
    if (m) marks.push(m);
  }
  return { marks, found };
}

/**
 * Rating panel (UI_SPEC_LEARN_GAMES §12.3, NAZAR §6.1–§6.2). Before the caller has rated: the blind
 * form (scrubber + hazard marks; nothing of the other rater, the AI proposal or the agreement is
 * rendered). After saving: the caller's own rating only, until the server reports that both ratings
 * exist (`ratings_visible`); then both ratings and the agreement.
 */
export function RatingPanel({
  clip,
  viewer,
  canRate,
  onSaved,
}: {
  clip: Clip;
  viewer: string | null;
  canRate: boolean;
  onSaved: (rating: ClipRating, source: Source) => void;
}) {
  const t = useTranslations("curator");
  const mine = myRating(clip, viewer);
  const shown = visibleRatings(clip, viewer);
  const open = OPEN_FOR_RATING.has(clip.status);

  if (!mine && open && canRate) return <RaterForm clip={clip} onSaved={onSaved} />;

  return (
    <section aria-labelledby="ratings-h" data-testid="ratings-view">
      <h2 id="ratings-h" className="md-h2">
        {clip.ratings_visible ? t("rate.both") : t("rate.yours")}
      </h2>
      {!clip.ratings_visible ? (
        <p className="cu-note" data-testid="rate-blind-note">
          {mine
            ? t("rate.saved")
            : open
              ? t("rate.notRater")
              : t("rate.closed", { status: t(`status.${clip.status}`) })}
        </p>
      ) : null}
      <ul className="cu-ratings">
        {shown.map((r) => (
          <RatingCard key={r.rating_id} rating={r} />
        ))}
      </ul>
      {clip.ratings_visible && clip.agreement ? <AgreementView agreement={clip.agreement} /> : null}
      {clip.ratings_visible && clip.proposals_visible && (clip.proposals ?? []).length > 0 ? (
        <p className="cu-hint">
          {t("rate.proposals")}:{" "}
          {(clip.proposals ?? [])
            .map((p) => `${p.hazard_type} ${clockTime(p.a_ms)}–${clockTime(p.b_ms)}`)
            .join("; ")}
        </p>
      ) : null}
    </section>
  );
}

export function RatingCard({ rating }: { rating: ClipRating }) {
  const t = useTranslations("curator");
  const locale = useLocale();
  return (
    <li className="cu-rating" data-testid={`rating-${rating.rater}`}>
      <p className="cu-rating__who">{t("rate.raterMarks", { rater: rating.rater })}</p>
      {rating.decision === "reject" ? (
        <p>{t("rate.rejected")}</p>
      ) : rating.marks.length === 0 ? (
        <p>{t("rate.quietLine")}</p>
      ) : (
        <ul>
          {rating.marks.map((m, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: marks have no id and never reorder
            <li key={i}>
              {t("rate.markLine", {
                type: hazardLabel(m.hazard_type, locale),
                a: clockTime(m.a_ms),
                b: clockTime(m.b_ms),
              })}
              {m.cue ? ` · “${m.cue}”` : ""}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function AgreementView({ agreement }: { agreement: ClipAgreement }) {
  const t = useTranslations("curator");
  const locale = useLocale();
  const s = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(2)} s`);
  return (
    <section aria-labelledby="agr-h" className="cu-agreement" data-testid="agreement">
      <h3 id="agr-h" className="md-h3">
        {t("agreement.h2")}
      </h3>
      <p data-testid="agreement-result" data-accepted={agreement.accepted}>
        {agreement.accepted ? t("agreement.accepted") : t("agreement.refused")}
      </p>
      <p className="cu-hint">
        {t("agreement.metrics", {
          matched: agreement.metrics.matched,
          onset: s(agreement.metrics.median_delta_onset_ms),
          end: s(agreement.metrics.median_delta_end_ms),
        })}
      </p>
      <ul className="cu-list">
        {(agreement.pairs ?? []).map((p) => (
          <li key={p.cluster_id}>
            {t("agreement.pairLine", {
              type: hazardLabel(p.a.hazard_type, locale),
              onset: (p.delta_onset_ms / 1000).toFixed(2),
              end: (p.delta_end_ms / 1000).toFixed(2),
              iou: p.iou.toFixed(2),
            })}
          </li>
        ))}
        {agreement.reasons.map((r) => (
          <li key={r}>{t(`agreement.reason.${r}`)}</li>
        ))}
      </ul>
    </section>
  );
}

function RaterForm({
  clip,
  onSaved,
}: {
  clip: Clip;
  onSaved: (rating: ClipRating, source: Source) => void;
}) {
  const t = useTranslations("curator");
  const locale = useLocale();
  const problem = useProblemText();
  const id = useId();
  const duration = clip.duration_ms ?? 0;
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState<"windows" | "quiet" | "reject">("windows");
  const seq = useRef(1);
  const [drafts, setDrafts] = useState<Draft[]>([
    { key: 0, hazard_type: "bus_stop_pedestrian", a: "", b: "", cue: "", occlusion: false },
  ]);
  const [issues, setIssues] = useState<Record<number, MarkIssue[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());

  const update = (k: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === k ? { ...d, ...patch } : d)));

  const toMark = draftToMark;

  const bands: ScrubBand[] =
    mode === "windows"
      ? drafts.flatMap((d, i) => {
          const m = toMark(d);
          return m && m.a_ms < m.b_ms
            ? [
                {
                  key: `d${d.key}`,
                  aMs: m.a_ms,
                  bMs: m.b_ms,
                  label: t("rate.hazard", { n: i + 1 }),
                  tone: "a" as const,
                },
              ]
            : [];
        })
      : [];

  const save = async () => {
    setFormError(null);
    const checked = mode === "windows" ? checkDrafts(drafts, duration) : { marks: [], found: {} };
    const marks = checked.marks;
    setIssues(checked.found);
    if (Object.keys(checked.found).length > 0) return;
    if (mode === "windows" && marks.length === 0) {
      setFormError(t("rate.errors.none"));
      return;
    }
    setBusy(true);
    try {
      const open = clip.review_tasks?.find((r) => r.status === "open");
      const r = await rateClip(
        clip.clip_id,
        {
          version: clip.version,
          ...(open ? { review_task_id: open.review_task_id } : {}),
          decision: mode === "reject" ? "reject" : "windows_set",
          marks,
        },
        key.current,
      );
      onSaved(r.data, r.source);
    } catch (e) {
      setFormError(problem(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="rate-form-h" data-testid="rater-form">
      <h2 id="rate-form-h" className="md-sr-only">
        {t("rate.save")}
      </h2>
      <p className="cu-note cu-note--blind" data-testid="rate-blind-note">
        {t("rate.blind")}
      </p>
      <details className="cu-defs">
        <summary>{t("rate.definitions")}</summary>
        <ul>
          <li>{t("rate.defHazard")}</li>
          <li>{t("rate.defOnset")}</li>
          <li>{t("rate.defEnd")}</li>
          <li>{t("rate.defQuiet")}</li>
        </ul>
      </details>
      <FrameScrubber
        durationMs={duration}
        mediaUrl={clip.media_url}
        placeholder={!clip.media_url}
        frame={frame}
        onFrame={setFrame}
        bands={bands}
      />
      <Fieldset className="cu-fieldset">
        <Fieldset.Legend className="cu-label">{t("rate.type")}</Fieldset.Legend>
        {(["windows", "quiet", "reject"] as const).map((m) => (
          <label key={m} className="cu-choice">
            <input
              type="radio"
              name={`${id}-mode`}
              checked={mode === m}
              onChange={() => setMode(m)}
              data-testid={`rate-mode-${m}`}
            />
            <span>
              {m === "windows"
                ? t("rate.modeWindows")
                : m === "quiet"
                  ? t("rate.quiet")
                  : t("rate.reject")}
            </span>
          </label>
        ))}
      </Fieldset>
      {mode === "windows" ? (
        <ol className="cu-marks">
          {drafts.map((d, i) => {
            const errs = issues[d.key] ?? [];
            const errId = `${id}-${d.key}-err`;
            return (
              <li key={d.key} className="cu-mark" data-testid={`mark-${i}`}>
                <h3 className="md-h3">{t("rate.hazard", { n: i + 1 })}</h3>
                <label className="cu-field">
                  <span className="cu-label">{t("rate.type")}</span>
                  <select
                    className="cu-select"
                    value={d.hazard_type}
                    onChange={(e) =>
                      update(d.key, { hazard_type: e.currentTarget.value as HazardType })
                    }
                    data-testid={`mark-${i}-type`}
                  >
                    {HAZARD_OPTIONS.map((h) => (
                      <option key={h} value={h}>
                        {hazardLabel(h, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="cu-hint">
                  {t("rate.typeDefinition", { text: hazardDefinition(d.hazard_type) })}
                </p>
                <div className="cu-pair">
                  <div className="cu-field">
                    <Label className="cu-label" htmlFor={`${id}-mark-${i}-a`}>
                      {t("rate.onset")}
                    </Label>
                    <Input
                      id={`${id}-mark-${i}-a`}
                      className="cu-input"
                      inputMode="decimal"
                      value={d.a}
                      onChange={(e) => update(d.key, { a: e.currentTarget.value })}
                      aria-invalid={errs.length > 0}
                      aria-describedby={errs.length > 0 ? errId : undefined}
                      data-testid={`mark-${i}-a`}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    onPress={() => update(d.key, { a: secondsText(frameToMs(frame)) })}
                  >
                    {t("rate.setOnset")}
                  </Button>
                </div>
                <div className="cu-pair">
                  <div className="cu-field">
                    <Label className="cu-label" htmlFor={`${id}-mark-${i}-b`}>
                      {t("rate.end")}
                    </Label>
                    <Input
                      id={`${id}-mark-${i}-b`}
                      className="cu-input"
                      inputMode="decimal"
                      value={d.b}
                      onChange={(e) => update(d.key, { b: e.currentTarget.value })}
                      aria-invalid={errs.length > 0}
                      aria-describedby={errs.length > 0 ? errId : undefined}
                      data-testid={`mark-${i}-b`}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    onPress={() => update(d.key, { b: secondsText(frameToMs(frame)) })}
                  >
                    {t("rate.setEnd")}
                  </Button>
                </div>
                <div className="cu-field">
                  <Label className="cu-label" htmlFor={`${id}-mark-${i}-cue`}>
                    {t("rate.cue")}
                  </Label>
                  <Input
                    id={`${id}-mark-${i}-cue`}
                    className="cu-input"
                    maxLength={160}
                    value={d.cue}
                    onChange={(e) => update(d.key, { cue: e.currentTarget.value })}
                    data-testid={`mark-${i}-cue`}
                  />
                  <span className="cu-hint">{t("rate.cueHint")}</span>
                </div>
                <label className="cu-choice">
                  <input
                    type="checkbox"
                    checked={d.occlusion}
                    onChange={(e) => update(d.key, { occlusion: e.currentTarget.checked })}
                  />
                  <span>{t("rate.occlusion")}</span>
                </label>
                {errs.length > 0 ? (
                  <ul id={errId} className="cu-error" role="alert">
                    {errs.map((e) => (
                      <li key={e}>{t(`rate.errors.${e}`)}</li>
                    ))}
                  </ul>
                ) : null}
                {drafts.length > 1 ? (
                  <Button
                    variant="ghost"
                    onPress={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                  >
                    {t("rate.remove", { n: i + 1 })}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {mode === "windows" && drafts.length < MAX_MARKS ? (
        <>
          <Button
            variant="secondary"
            onPress={() => {
              const k = seq.current++;
              setDrafts((ds) => [
                ...ds,
                {
                  key: k,
                  hazard_type: "bus_stop_pedestrian",
                  a: "",
                  b: "",
                  cue: "",
                  occlusion: false,
                },
              ]);
            }}
            data-testid="mark-add"
          >
            {t("rate.add")}
          </Button>
          <p className="cu-hint">{t("rate.max")}</p>
        </>
      ) : null}
      {formError ? (
        <p role="alert" className="cu-error" data-testid="rate-error">
          {formError}
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        isPending={busy}
        onPress={() => void save()}
        data-testid="rate-save"
      >
        {t("rate.save")}
      </Button>
    </section>
  );
}
