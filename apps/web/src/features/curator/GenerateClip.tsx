"use client";

import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { generateClip, listScenes, type Source } from "./api";
import { hazardLabel } from "./hazards";
import { useProblemText } from "./problem";
import { CuratorLoading, CuratorOfflineNote, MockSourceNote } from "./states";
import type { NazarScene } from "./types";
import { newKey } from "./use-clip";

export const BATCH_RE = /^[A-Za-z0-9-]{3,40}$/;

const todayBatch = () => `batch-${new Date().toISOString().slice(0, 10)}`;

/**
 * Generate a clip (ADR-0013: Nazar clips are AI-generated practice scenes): pick a scene of
 * `content/nazar/scenes.json` and start the clip_generate workflow (`POST /v1/admin/clips/generate
 * {sceneId, version, batchId}`). The 202 answer is the workflow run; the clip enters the board as
 * `origin: ai_generated` once the task registers it, and still needs the synthetic review, two
 * blind raters, agreement and cue texts before a curator can publish it.
 */
export function GenerateClip({ catalogue = [] }: { catalogue?: readonly NazarScene[] }) {
  const t = useTranslations("curator");
  const locale = useLocale();
  const problem = useProblemText();
  const id = useId();
  const [scenes, setScenes] = useState<{ list: readonly NazarScene[]; source: Source } | null>(
    null,
  );
  const [scene, setScene] = useState<string | null>(null);
  const [batch, setBatch] = useState(todayBatch);
  const [errors, setErrors] = useState<("scene" | "batch")[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string | null; run: string; source: Source } | null>(null);
  const key = useRef(newKey());

  useEffect(() => {
    let alive = true;
    listScenes(catalogue).then((r) => alive && setScenes({ list: r.data, source: r.source }));
    return () => {
      alive = false;
    };
  }, [catalogue]);

  const start = async () => {
    const found: ("scene" | "batch")[] = [];
    if (!scene) found.push("scene");
    if (!BATCH_RE.test(batch.trim())) found.push("batch");
    setErrors(found);
    setErr(null);
    const picked = scenes?.list.find((s) => s.scene_id === scene);
    if (found.length > 0 || !picked) return;
    setBusy(true);
    try {
      const r = await generateClip(
        { sceneId: picked.scene_id, version: picked.revision, batchId: batch.trim() },
        key.current,
      );
      key.current = newKey();
      setDone({
        id: r.data.clip?.clip_id ?? null,
        run: r.data.workflow_run.run_id,
        source: r.source,
      });
    } catch (e) {
      setErr(problem(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cu-page" data-screen="ADMIN-CLIP-GENERATE" data-testid="generate-clip">
      <CuratorOfflineNote />
      <Link href="/admin/clips" className="md-link">
        ← {t("states.back")}
      </Link>
      <h1 className="md-h1">{t("generate.h1")}</h1>
      <p className="cu-lead">{t("generate.lead")}</p>
      {!scenes ? <CuratorLoading /> : null}
      {done ? (
        <GenerateDone {...done} />
      ) : scenes ? (
        <form
          className="cu-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          {scenes.source === "mock" ? (
            <p className="cu-mocknote" role="note">
              {t("generate.scenesMock")}
            </p>
          ) : null}
          <fieldset className="cu-fieldset">
            <legend className="cu-label">{t("generate.scenes")}</legend>
            {scenes.list.length === 0 ? <p className="cu-hint">{t("generate.noScenes")}</p> : null}
            {scenes.list.map((s) => (
              <label key={s.scene_id} className="cu-choice cu-choice--card">
                <input
                  type="radio"
                  name={`${id}-scene`}
                  checked={scene === s.scene_id}
                  onChange={() => setScene(s.scene_id)}
                  data-testid={`scene-${s.scene_id}`}
                />
                <span>
                  <span className="cu-label">{locale === "hi" ? s.title.hi : s.title.en}</span>
                  <br />
                  <span className="cu-hint">
                    {s.scene_id}
                    {s.hazard_type
                      ? ` · ${t("generate.sceneMeta", {
                          hazard: hazardLabel(s.hazard_type, locale),
                          s: s.duration_s ?? 30,
                        })}`
                      : ""}
                  </span>
                </span>
              </label>
            ))}
            {errors.includes("scene") ? (
              <p className="cu-error" role="alert">
                {t("generate.pick")}
              </p>
            ) : null}
          </fieldset>
          <label className="cu-field">
            <span className="cu-label">{t("generate.batch")}</span>
            <input
              className="cu-input"
              value={batch}
              maxLength={40}
              aria-invalid={errors.includes("batch")}
              onChange={(e) => setBatch(e.currentTarget.value)}
              data-testid="generate-batch"
            />
            <span className="cu-hint">{t("generate.batchHint")}</span>
            {errors.includes("batch") ? (
              <span className="cu-error" role="alert">
                {t("generate.batchError")}
              </span>
            ) : null}
          </label>
          {err ? (
            <p role="alert" className="cu-error">
              {err}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            isPending={busy}
            data-testid="generate-start"
          >
            {t("generate.start")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** The 202 answer: the clip once the task registered it, else the workflow run to wait for. */
function GenerateDone({ id, run, source }: { id: string | null; run: string; source: Source }) {
  const t = useTranslations("curator");
  return (
    <div role="status" className="cu-ok" data-testid="generate-done">
      <MockSourceNote source={source} />
      <p>{id ? t("generate.started", { id }) : t("generate.queued", { run })}</p>
      <Link
        href={id ? `/admin/clips/${id}` : "/admin/clips"}
        className={buttonClassName({ variant: "primary", size: "lg" })}
      >
        {id ? t("generate.open", { id }) : t("states.back")}
      </Link>
    </div>
  );
}
