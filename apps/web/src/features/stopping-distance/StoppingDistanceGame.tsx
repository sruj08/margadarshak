"use client";

import type { GameEventType, PayloadOf, SessionContext } from "@margdarshak/game-core/schema";
import type { EventRecorder } from "@margdarshak/game-core/sdk";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WebGameModule, WebGameProps } from "@/features/games/types";
import { type SdItem, sdItems } from "./rounds";
import { BrakeReflex } from "./rounds/BrakeReflex";
import { PredictReveal } from "./rounds/PredictReveal";
import { SpeedForSight } from "./rounds/SpeedForSight";
import type { Emit } from "./rounds/types";

/** Number of round kinds (predict, react, speed for sight): "Round 2 of 3". */
const ROUND_KINDS = 3;

/**
 * G2 Stopping Distance on the shared host (GAME_DESIGN §3, UI_SPEC_LEARN_GAMES §5.2): SVG + CSS, no
 * Phaser. Plays the session's rounds in order; each item is `item_start` → the round's own events
 * (`estimate`, `speed_choice`, `brake`) → `item_end {done}`. Items are timed for the host: a hidden
 * page voids the item on screen (`item_end {voided}`, as the scorer's integrity check would) and the
 * next one starts. No score is shown in play; the host shows the server-checked (or provisional)
 * result at the end, and findings come from the debrief layer.
 */
export function StoppingDistanceGame(props: WebGameProps) {
  const t = useTranslations("sims.sd");
  const { ctx, session, register, setHud, setCurrentItem, onEnd } = props;
  const items = useMemo(() => sdItems(session), [session]);
  const [pos, setPos] = useState(-1);
  const [deal, setDeal] = useState(0);
  const rec = useRef<EventRecorder>(props.recorder);
  const open = useRef<SdItem | null>(null);
  const posRef = useRef(-1);

  const tag = useCallback(
    (it: SdItem) => {
      const r = it.round;
      const surface = r.surface === "wet" ? t("wet") : t("dry");
      const detail =
        r.round === 1
          ? t("at", { kmh: r.speedKmh, surface })
          : r.round === 2
            ? t("street", { surface })
            : t("bend", { surface });
      return `${t("roundOf", { r: r.round, n: ROUND_KINDS })} · ${detail}`;
    },
    [t],
  );

  const startAt = useCallback(
    (i: number) => {
      const it = items[i];
      posRef.current = i;
      if (!it) {
        open.current = null;
        setCurrentItem(null, false);
        onEnd("completed");
        return;
      }
      rec.current.emit("item_start", { ref: it.ref }, { item: it.index });
      open.current = it;
      setCurrentItem(it.index, true);
      setHud({ counter: { current: i + 1, total: items.length }, tag: tag(it) });
      setPos(i);
      setDeal((n) => n + 1);
    },
    [items, setCurrentItem, setHud, onEnd, tag],
  );

  const closeOpen = useCallback((reason: "done" | "voided") => {
    const it = open.current;
    if (!it) return;
    rec.current.emit("item_end", { ref: it.ref, reason }, { item: it.index });
    open.current = null;
  }, []);

  const next = useCallback(() => {
    closeOpen("done");
    startAt(posRef.current + 1);
  }, [closeOpen, startAt]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one module per mount
  useEffect(() => {
    const m: WebGameModule = {
      timingMode: "none",
      init(_ctx: SessionContext, recorder: EventRecorder) {
        rec.current = recorder;
        props.reportProgress({ loaded: items.length, total: items.length, unit: "items" });
      },
      start() {
        startAt(0);
      },
      // The rounds read the host's `paused` prop: timers stop and a street ride restarts.
      pause() {},
      resume() {},
      onItemVoided() {
        closeOpen("voided");
        startAt(posRef.current + 1);
      },
      end() {
        closeOpen("done");
      },
      getPreview: () => null,
      destroy() {
        open.current = null;
      },
    };
    return register(m);
  }, []);

  const it = pos >= 0 ? items[pos] : undefined;
  const emit = useCallback<Emit>(<T extends GameEventType>(type: T, payload: PayloadOf<T>) => {
    const cur = open.current;
    if (cur) rec.current.emit(type, payload, { item: cur.index });
  }, []);

  if (!it) {
    return items.length === 0 ? (
      <div className="mg-overlay" role="alert" data-testid="sd-empty">
        <p className="mg-overlay__title">{t("noRounds")}</p>
      </div>
    ) : null;
  }
  const common = {
    item: it.index,
    seed: ctx.seed,
    mode: ctx.mode,
    emit,
    paused: props.paused,
    reducedMotion: props.a11y.reducedMotion,
    screenReaderAlt: props.a11y.screenReaderAlt,
    heading: t("roundOf", { r: it.round.round, n: ROUND_KINDS }),
    onNext: next,
  };
  const key = `${it.index}:${deal}`;
  return (
    <div
      className={`sd-game${props.a11y.leftHanded ? " sd-game--left" : ""}${props.a11y.reducedMotion ? " sd-game--still" : ""}`}
      data-testid="sd-game"
    >
      {it.round.round === 1 ? (
        <PredictReveal key={key} {...common} spec={it.round} />
      ) : it.round.round === 2 ? (
        <BrakeReflex key={key} {...common} spec={it.round} />
      ) : (
        <SpeedForSight key={key} {...common} spec={it.round} />
      )}
    </div>
  );
}
