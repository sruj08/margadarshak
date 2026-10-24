"use client";

import { Button } from "@margdarshak/ui/components/button";
import { useTranslations } from "next-intl";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { recordBlurAudit, type Source } from "./api";
import { FrameScrubber } from "./FrameScrubber";
import { useProblemText } from "./problem";
import { framesTotal, isAi } from "./rules";
import type { Clip, ClipBlurAuditCreate, MissKind } from "./types";
import { newKey } from "./use-clip";

const BUCKETS = 60;
const NOT_AUDITABLE = new Set(["raw", "transcoded", "published", "retired"]);

/** Frames-checked bookkeeping for a 100% audit: a bitmap over every frame of the rendition. */
export class FrameLedger {
  private readonly seen: Uint8Array;
  private n = 0;
  constructor(public readonly total: number) {
    this.seen = new Uint8Array(total);
  }
  mark(from: number, to: number): void {
    const a = Math.max(0, Math.min(from, to));
    const b = Math.min(this.total - 1, Math.max(from, to));
    for (let f = a; f <= b; f++) {
      if (this.seen[f] === 0) {
        this.seen[f] = 1;
        this.n++;
      }
    }
  }
  get checked(): number {
    return this.n;
  }
  buckets(count: number): number[] {
    const out = new Array<number>(count).fill(0);
    const size = this.total / count;
    for (let i = 0; i < count; i++) {
      const a = Math.floor(i * size);
      const b = Math.max(a + 1, Math.floor((i + 1) * size));
      let s = 0;
      for (let f = a; f < b && f < this.total; f++) s += this.seen[f] ?? 0;
      out[i] = s / (b - a);
    }
    return out;
  }
}

interface Miss {
  frame: number;
  kind: MissKind;
  note: string;
}

/**
 * Human blur audit (NAZAR §5, UI_SPEC_LEARN_GAMES §12.2): every frame put on screen (played at up
 * to 4× or stepped) counts as checked; the auditor marks missed faces, plates and other personal
 * information at the current frame. Publish needs 100% of frames and 0 misses on the exact
 * rendition (its sha256); a miss sends the clip back to blur with manual masks.
 */
export function BlurAudit({
  clip,
  onSaved,
}: {
  clip: Clip;
  onSaved: (clip: Clip, source: Source) => void;
}) {
  const t = useTranslations("curator");
  const problem = useProblemText();
  const id = useId();
  const duration = clip.duration_ms ?? 0;
  const total = framesTotal(duration);
  const ledger = useRef(new FrameLedger(total));
  const [checked, setChecked] = useState(0);
  const [tick, setTick] = useState(0);
  const [frame, setFrame] = useState(0);
  const [misses, setMisses] = useState<Miss[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"passed" | "failed" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = useRef(newKey());
  const rendition = clip.media?.find((m) => m.res === "480p") ?? clip.media?.[0];

  const onShown = useCallback((from: number, to: number) => {
    ledger.current.mark(from, to);
    setChecked(ledger.current.checked);
    setTick((n) => n + 1);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed when frames are marked
  const coverage = useMemo(() => ledger.current.buckets(BUCKETS), [tick]);

  if (isAi(clip)) {
    return (
      <div className="cu-note" data-testid="audit-ai-skip">
        <p>{t("audit.aiSkip")}</p>
        <Link href={`/admin/clips/${clip.clip_id}/review`} className="md-link">
          {t("audit.toReview")}
        </Link>
      </div>
    );
  }
  if (NOT_AUDITABLE.has(clip.status) || !rendition || duration <= 0) {
    return (
      <p className="cu-note" data-testid="audit-unavailable">
        {t("audit.noRendition")}
      </p>
    );
  }

  const pct = Math.floor((checked / total) * 100);
  const addMiss = (kind: MissKind) => {
    setMisses((m) =>
      [
        ...m.filter((x) => !(x.frame === frame && x.kind === kind)),
        { frame, kind, note: note.trim() },
      ].sort((a, b) => a.frame - b.frame),
    );
    setNote("");
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    const body: ClipBlurAuditCreate = {
      version: clip.version,
      rendition_sha256: rendition.sha256,
      frames_total: total,
      frames_checked: checked,
      misses: misses.length,
      miss_frames: misses.map((m) => ({
        frame: m.frame,
        kind: m.kind,
        ...(m.note ? { note: m.note } : {}),
      })),
    };
    try {
      const r = await recordBlurAudit(clip.clip_id, body, key.current);
      key.current = newKey();
      setResult(r.data.blur_audit?.passed ? "passed" : "failed");
      onSaved(r.data, r.source);
    } catch (e) {
      setErr(problem(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="audit-h" data-testid="blur-audit">
      <h2 id="audit-h" className="md-sr-only">
        {t("audit.save")}
      </h2>
      <p className="cu-lead">{t("audit.lead")}</p>
      <p className="cu-hint">
        {t("audit.rendition")}: <code>{rendition.sha256.slice(0, 16)}…</code> ({rendition.res})
      </p>
      {clip.blur_audit ? (
        <p className="cu-hint" data-testid="audit-current">
          {t("audit.current", {
            checked: clip.blur_audit.frames_checked,
            total: clip.blur_audit.frames_total,
            misses: clip.blur_audit.misses,
            auditor: clip.blur_audit.auditor,
          })}
        </p>
      ) : null}
      <FrameScrubber
        durationMs={duration}
        mediaUrl={clip.media_url}
        placeholder={!clip.media_url}
        frame={frame}
        onFrame={setFrame}
        onShown={onShown}
        speeds={[0.25, 1, 2, 4]}
        defaultSpeed={4}
        coverage={coverage}
      />
      <p className="cu-hint">{t("audit.playHint")}</p>
      <div className="cu-progress">
        <div
          className="cu-progress__bar"
          role="progressbar"
          aria-label={t("audit.progressLabel")}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={checked}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <p data-testid="audit-progress">{t("audit.progress", { checked, total, pct })}</p>
      </div>
      <label className="cu-field" htmlFor={`${id}-note`}>
        <span className="cu-label">{t("audit.missNote")}</span>
        <input
          id={`${id}-note`}
          className="cu-input"
          maxLength={120}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
      </label>
      <div className="cu-row cu-row--wrap">
        <Button variant="secondary" onPress={() => addMiss("face")} data-testid="miss-face">
          {t("audit.missFace")}
        </Button>
        <Button variant="secondary" onPress={() => addMiss("plate")} data-testid="miss-plate">
          {t("audit.missPlate")}
        </Button>
        <Button variant="secondary" onPress={() => addMiss("other_pii")}>
          {t("audit.missOther")}
        </Button>
      </div>
      <h3 className="md-h3">{t("audit.misses", { n: misses.length })}</h3>
      {misses.length === 0 ? (
        <p className="cu-hint">{t("audit.noMisses")}</p>
      ) : (
        <ul className="cu-list" data-testid="audit-misses">
          {misses.map((m) => (
            <li key={`${m.frame}-${m.kind}`} className="cu-row">
              <span>
                {t("audit.missAt", { frame: m.frame + 1, kind: t(`audit.kind.${m.kind}`) })}
                {m.note ? ` · ${m.note}` : ""}
              </span>
              <Button
                variant="ghost"
                onPress={() => setMisses((all) => all.filter((x) => x !== m))}
              >
                {t("audit.remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {checked < total ? (
        <p className="cu-note">{t("audit.incomplete", { n: total - checked })}</p>
      ) : null}
      {err ? (
        <p role="alert" className="cu-error">
          {err}
        </p>
      ) : null}
      {result ? (
        <p
          role="status"
          className={result === "passed" ? "cu-ok" : "cu-error"}
          data-testid="audit-result"
        >
          {result === "passed"
            ? t("audit.passed")
            : `${t("audit.failed")} ${misses.length > 0 ? t("audit.reblur") : ""}`}
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        isPending={busy}
        onPress={() => void save()}
        data-testid="audit-save"
      >
        {t("audit.save")}
      </Button>
    </section>
  );
}
