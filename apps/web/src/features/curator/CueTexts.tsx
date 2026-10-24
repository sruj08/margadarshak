"use client";

import { Input, Label } from "@heroui/react";
import { Button } from "@margdarshak/ui/components/button";
import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { findPii } from "@/lib/redact/redact";
import { type Source, setCueTexts } from "./api";
import { hazardLabel } from "./hazards";
import { useProblemText } from "./problem";
import { clockTime } from "./rules";
import type { Clip } from "./types";
import { newKey } from "./use-clip";

type CueErr = "required" | "pii";

/** Every cue the raters wrote for a hazard type (hints for the curator). */
function raterCuesFor(clip: Clip, hazardType: string): string[] {
  const out = new Set<string>();
  const marks = (clip.ratings ?? []).flatMap((r) => r.marks);
  for (const m of marks) if (m.hazard_type === hazardType && m.cue) out.add(m.cue);
  const finals = (clip.agreement?.final_hazards ?? []).filter((f) => f.hazard_type === hazardType);
  for (const c of finals.flatMap((f) => f.cues ?? [])) out.add(c);
  return [...out];
}

/** Both lines required (1–160 characters) and free of personal data, per hazard. */
export function cueErrors(
  hazardIds: readonly string[],
  cues: Readonly<Record<string, { en: string; hi: string }>>,
): Record<string, CueErr> {
  const found: Record<string, CueErr> = {};
  for (const id of hazardIds) {
    for (const lang of ["en", "hi"] as const) {
      const v = (cues[id]?.[lang] ?? "").trim();
      if (!v || v.length > 160) found[`${id}.${lang}`] = "required";
      else if (findPii(v).length > 0) found[`${id}.${lang}`] = "pii";
    }
  }
  return found;
}

/**
 * Cue texts (NAZAR §3.2 `cueText`): one line per final hazard in English and Hindi, written by the
 * curator from the raters' cues, plus the curator difficulty (NAZAR §7.1 rubric). Both are
 * preconditions of publish. Uses the proposed `PUT …/cue-texts` route (see api.ts).
 */
export function CueTexts({
  clip,
  onSaved,
}: {
  clip: Clip;
  onSaved: (clip: Clip, source: Source) => void;
}) {
  const t = useTranslations("curator");
  const locale = useLocale();
  const problem = useProblemText();
  const id = useId();
  const hazards = clip.hazards ?? [];
  const [cues, setCues] = useState<Record<string, { en: string; hi: string }>>(() =>
    Object.fromEntries(
      hazards.map((h) => [h.hazard_id, { en: h.cue_text?.en ?? "", hi: h.cue_text?.hi ?? "" }]),
    ),
  );
  const [difficulty, setDifficulty] = useState<string>(
    typeof clip.difficulty?.curator === "number" ? String(clip.difficulty.curator) : "",
  );
  const [errors, setErrors] = useState<Record<string, CueErr>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());

  if (clip.status !== "rated") {
    return (
      <p className="cu-note" data-testid="cues-closed">
        {t("cues.notRated", { status: t(`status.${clip.status}`) })}
      </p>
    );
  }

  const raterCues = (hazardType: string) => raterCuesFor(clip, hazardType);

  const save = async () => {
    const found = cueErrors(
      hazards.map((h) => h.hazard_id),
      cues,
    );
    setErrors(found);
    setErr(null);
    setSaved(false);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const d = Number(difficulty);
      const r = await setCueTexts(
        clip.clip_id,
        {
          version: clip.version,
          cues: Object.fromEntries(
            hazards.map((h) => [
              h.hazard_id,
              {
                en: (cues[h.hazard_id]?.en ?? "").trim(),
                hi: (cues[h.hazard_id]?.hi ?? "").trim(),
              },
            ]),
          ),
          ...(difficulty && d >= 1 && d <= 5 ? { difficulty_curator: d } : {}),
        },
        key.current,
      );
      key.current = newKey();
      setSaved(true);
      onSaved(r.data, r.source);
    } catch (e) {
      setErr(problem(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="cues-h" data-testid="cue-texts">
      <h2 id="cues-h" className="md-sr-only">
        {t("cues.save")}
      </h2>
      <p className="cu-lead">{t("cues.lead")}</p>
      <ol className="cu-marks">
        {hazards.map((h) => {
          const hints = raterCues(h.hazard_type);
          return (
            <li key={h.hazard_id} className="cu-mark" data-testid={`cue-${h.hazard_id}`}>
              <h3 className="md-h3">
                {h.hazard_id} · {hazardLabel(h.hazard_type, locale)} · {clockTime(h.a_ms)} –{" "}
                {clockTime(h.b_ms)}
              </h3>
              <p className="cu-hint">
                {hints.length > 0
                  ? t("cues.raterCues", { cues: hints.map((c) => `“${c}”`).join(", ") })
                  : t("cues.noRaterCues")}
              </p>
              {(["en", "hi"] as const).map((lang) => {
                const k = `${h.hazard_id}.${lang}`;
                const e = errors[k];
                return (
                  <div key={lang} className="cu-field">
                    <Label className="cu-label" htmlFor={`${id}-cue-${h.hazard_id}-${lang}`}>
                      {t(`cues.${lang}`)}
                    </Label>
                    <Input
                      id={`${id}-cue-${h.hazard_id}-${lang}`}
                      className="cu-input"
                      lang={lang}
                      maxLength={160}
                      value={cues[h.hazard_id]?.[lang] ?? ""}
                      aria-invalid={!!e}
                      onChange={(ev) => {
                        const v = ev.currentTarget.value;
                        setCues((all) => ({
                          ...all,
                          [h.hazard_id]: { ...(all[h.hazard_id] ?? { en: "", hi: "" }), [lang]: v },
                        }));
                      }}
                      data-testid={`cue-${h.hazard_id}-${lang}`}
                    />
                    {e ? (
                      <span className="cu-error" role="alert">
                        {t(`cues.errors.${e}`)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </li>
          );
        })}
      </ol>
      <label className="cu-field" htmlFor={`${id}-diff`}>
        <span className="cu-label">{t("cues.difficulty")}</span>
        <select
          id={`${id}-diff`}
          className="cu-select"
          value={difficulty}
          onChange={(e) => setDifficulty(e.currentTarget.value)}
          data-testid="cue-difficulty"
        >
          <option value="">{t("cues.pick")}</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </select>
        <span className="cu-hint">{t("cues.difficultyHint")}</span>
      </label>
      {err ? (
        <p role="alert" className="cu-error">
          {err}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="cu-ok" data-testid="cues-saved">
          {t("cues.saved")}
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        isPending={busy}
        onPress={() => void save()}
        data-testid="cues-save"
      >
        {t("cues.save")}
      </Button>
    </section>
  );
}
