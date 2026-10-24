"use client";

import type { SessionContext } from "@margdarshak/game-core/schema";
import type { EventRecorder } from "@margdarshak/game-core/sdk";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WebGameModule, WebGameProps } from "@/features/games/types";
import { hasWebGL } from "@/features/phaser/context-loss";
import { DecisionPartA } from "./decision-variant/DecisionPartA";
import { DecisionPartB } from "./decision-variant/DecisionPartB";
import { type BsPlayItem, bsItems } from "./items";
import { PhaserPartA } from "./PhaserPartA";
import { PhaserPartB } from "./PhaserPartB";

export type BsVariant = "canvas" | "decision";

/** True on Lite (the `md_lite` cookie, FRONTEND §9): no Phaser there. */
function liteCookie(): boolean {
  return (
    typeof document !== "undefined" && /(?:^|;\s*)md_lite=(?:1|true|on)\b/.test(document.cookie)
  );
}

/**
 * The variant to play: the decision version when the URL asks for it (`?variant=decision`, the
 * brief's link), the learner chose the screen-reader alternative, Lite mode is on, or this browser
 * has no WebGL. Phaser is then never requested (EC-19).
 */
export function chooseVariant(a: { screenReaderAlt: boolean }): BsVariant {
  if (typeof window === "undefined") return "decision";
  const q = new URLSearchParams(window.location.search).get("variant");
  if (q === "decision") return "decision";
  if (a.screenReaderAlt || liteCookie() || !hasWebGL()) return "decision";
  return "canvas";
}

/**
 * G3 Blind Spot on the shared host (GAME_DESIGN §4, UI_SPEC_LEARN_GAMES §5.3). Part A items
 * (placement) and Part B items (the ride), in session order, each as `item_start` → the part's
 * events (`place`, or `lane_pos` + `mirror_check` [+ `decision` in the decision version]) →
 * `item_end`. Items are timed for the host: a hidden page voids the item on screen and the next one
 * starts. A canvas failure switches the rest of the session to the decision version.
 */
export function BlindSpotGame(props: WebGameProps) {
  const t = useTranslations("sims.bs");
  const { ctx, session, register, setHud, setCurrentItem, onEnd, a11y } = props;
  const items = useMemo(() => bsItems(session), [session]);
  const [variant, setVariant] = useState<BsVariant | null>(null);
  const [pos, setPos] = useState(-1);
  const [deal, setDeal] = useState(0);
  const rec = useRef<EventRecorder>(props.recorder);
  const open = useRef<BsPlayItem | null>(null);
  const posRef = useRef(-1);

  // Chosen once per session: switching mid-ride would restart the item.
  useEffect(() => setVariant((v) => v ?? chooseVariant(a11y)), [a11y]);

  const hud = useCallback(
    (i: number, it: BsPlayItem) => {
      const vehicle = t(`vehicle.${it.spec.vehicleType}`);
      setHud({
        counter: { current: i + 1, total: items.length },
        tag: `${it.spec.part === "A" ? t("partAShort") : t("partBShort")} · ${vehicle}`,
      });
    },
    [items.length, setHud, t],
  );

  /** Opens an item: Part A at once; Part B when its ride starts (see `beginRide`). */
  const show = useCallback(
    (i: number) => {
      const it = items[i];
      posRef.current = i;
      open.current = null;
      if (!it) {
        setCurrentItem(null, false);
        onEnd("completed");
        return;
      }
      if (it.spec.part === "A") {
        rec.current.emit("item_start", { ref: it.ref }, { item: it.index });
        open.current = it;
        setCurrentItem(it.index, true);
      } else setCurrentItem(null, false);
      hud(i, it);
      setPos(i);
      setDeal((n) => n + 1);
    },
    [items, setCurrentItem, onEnd, hud],
  );

  const beginRide = useCallback(() => {
    const it = items[posRef.current];
    if (!it) return;
    rec.current.emit("item_start", { ref: it.ref }, { item: it.index });
    open.current = it;
    setCurrentItem(it.index, true);
  }, [items, setCurrentItem]);

  const closeOpen = useCallback((reason: "done" | "voided") => {
    const it = open.current;
    if (!it) return;
    rec.current.emit("item_end", { ref: it.ref, reason }, { item: it.index });
    open.current = null;
  }, []);

  const next = useCallback(() => {
    closeOpen("done");
    show(posRef.current + 1);
  }, [closeOpen, show]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one module per mount
  useEffect(() => {
    const m: WebGameModule = {
      timingMode: "sim",
      init(_ctx: SessionContext, recorder: EventRecorder) {
        rec.current = recorder;
        props.reportProgress({ loaded: items.length, total: items.length, unit: "items" });
      },
      start() {
        show(0);
      },
      // Children read the host's `paused` prop (the canvas loop sleeps, the DOM loop stops).
      pause() {},
      resume() {},
      onItemVoided() {
        closeOpen("voided");
        show(posRef.current + 1);
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

  const place = useCallback((probe: { x: number; y: number }) => {
    const it = open.current;
    if (it) rec.current.emit("place", { zoneProbe: probe }, { item: it.index });
  }, []);
  const toDecision = useCallback(() => setVariant("decision"), []);

  const it = pos >= 0 ? items[pos] : undefined;
  if (items.length === 0)
    return (
      <div className="mg-overlay" role="alert" data-testid="bs-empty">
        <p className="mg-overlay__title">{t("noItems")}</p>
      </div>
    );
  if (!it || variant === null) return null;
  const key = `${it.index}:${deal}:${variant}`;
  const learn = ctx.mode === "learn";
  return (
    <div className="sd-game bs-game" data-testid="bs-game" data-variant={variant}>
      {variant === "decision" ? (
        <p className="bs-format" data-testid="bs-format-note">
          {t("decisionNote")}
        </p>
      ) : null}
      {it.spec.part === "A" ? (
        variant === "decision" ? (
          <DecisionPartA
            key={key}
            spec={it.spec}
            seed={ctx.seed}
            item={it.index}
            learn={learn}
            place={place}
            onDone={next}
          />
        ) : (
          <PhaserPartA
            key={key}
            spec={it.spec}
            seed={ctx.seed}
            item={it.index}
            learn={learn}
            tapOnly={a11y.tapOnly}
            paused={props.paused}
            reducedMotion={a11y.reducedMotion}
            place={place}
            onDone={next}
            onCanvasError={toDecision}
          />
        )
      ) : variant === "decision" ? (
        <DecisionPartB
          key={key}
          spec={it.spec}
          item={it.index}
          recorder={rec.current}
          paused={props.paused}
          begin={beginRide}
          onDone={next}
        />
      ) : (
        <PhaserPartB
          key={key}
          spec={it.spec}
          item={it.index}
          recorder={rec.current}
          paused={props.paused}
          reducedMotion={a11y.reducedMotion}
          leftHanded={a11y.leftHanded}
          begin={beginRide}
          onDone={next}
          onCanvasError={toDecision}
        />
      )}
    </div>
  );
}
