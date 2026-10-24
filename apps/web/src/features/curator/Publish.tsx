"use client";

import { Button } from "@margdarshak/ui/components/button";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { CuratorApiError, publishClip, type Source } from "./api";
import { useProblemText } from "./problem";
import { canPublish, type PublishCheckId, publishChecks } from "./rules";
import type { Clip } from "./types";
import { newKey } from "./use-clip";

const CHECK_IDS: readonly PublishCheckId[] = [
  "status",
  "two_ratings",
  "agreement",
  "blur_audit",
  "synthetic_review",
  "flash_check",
  "cue_texts",
  "duration",
  "speed",
  "difficulty",
  "licence",
  "missing_rendition",
];

/**
 * Publish (UI_SPEC_LEARN_GAMES §12.5): every precondition of clip-pipeline `transition(clip,
 * published)` as a checklist with what to do when it fails; the button stays disabled until all
 * pass. A server refusal (409 CLIP_INVALID_TRANSITION) is explained with the failing checks.
 */
export function Publish({
  clip,
  onPublished,
}: {
  clip: Clip;
  onPublished: (clip: Clip, source: Source) => void;
}) {
  const t = useTranslations("curator");
  const problem = useProblemText();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const key = useRef(newKey());
  const checks = publishChecks(clip);
  const ready = canPublish(clip);

  const go = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const r = await publishClip(clip.clip_id, key.current);
      setDone(true);
      onPublished(r.data, r.source);
    } catch (e) {
      key.current = newKey();
      if (e instanceof CuratorApiError && e.status === 409 && e.detail) {
        const failing = e.detail
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is PublishCheckId => (CHECK_IDS as readonly string[]).includes(s));
        setRefusal(
          t("publish.refused", {
            reason:
              failing.length > 0
                ? failing.map((f) => t(`publish.check.${f}`)).join("; ")
                : e.detail,
          }),
        );
      } else setRefusal(t("publish.refused", { reason: problem(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="pub-h" data-testid="publish">
      <p className="cu-lead">{t("publish.lead")}</p>
      <h2 id="pub-h" className="md-h3">
        {t("publish.checks")}
      </h2>
      <ul className="cu-checks">
        {checks.map((c) => (
          <li key={c.id} className="cu-check" data-testid={`check-${c.id}`} data-ok={c.ok}>
            <StatusGlyph kind={c.ok ? "done" : "caution"} size={20} />
            <div>
              <p>
                {t(`publish.check.${c.id}`)}{" "}
                <span className="md-sr-only">
                  ({c.ok ? t("publish.ok") : t("publish.missing")})
                </span>
              </p>
              {!c.ok ? <p className="cu-hint">{t(`publish.fix.${c.id}`)}</p> : null}
            </div>
          </li>
        ))}
      </ul>
      {clip.status === "published" ? (
        <p role="status" className="cu-ok" data-testid="publish-done">
          {done ? t("publish.done") : t("publish.already")}
        </p>
      ) : (
        <>
          {!ready ? (
            <p className="cu-note" data-testid="publish-blocked">
              {t("publish.blocked")}
            </p>
          ) : null}
          {refusal ? (
            <p role="alert" className="cu-error" data-testid="publish-refused">
              {refusal}
            </p>
          ) : null}
          <Button
            variant="primary"
            size="lg"
            fullWidth
            isDisabled={!ready}
            isPending={busy}
            onPress={() => void go()}
            data-testid="publish-go"
          >
            {t("publish.go")}
          </Button>
        </>
      )}
    </section>
  );
}
