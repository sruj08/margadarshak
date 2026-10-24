"use client";

import { useTranslations } from "next-intl";
import { type MutableRefObject, useEffect, useRef } from "react";
import type { ScenePlan } from "./choreo";
import { RICH, RichWorld } from "./rich/rich";
import { World } from "./world";

/**
 * The clip area for a simulated 3D scene (NAZAR §17). It draws the scene for the media time in
 * `mtRef` and nothing else: taps, timing and scoring stay with the player and the server replay.
 * Labelled on screen as a simulated scene, in mocks too (the label says nothing about where a
 * hazard is). If WebGL fails after mount, `onFail` lets the player fall back to the timeline.
 */
export function Scene3D({
  plan,
  mtRef,
  reducedMotion,
  onFail,
}: {
  plan: ScenePlan;
  mtRef: MutableRefObject<number>;
  reducedMotion: boolean;
  onFail: () => void;
}) {
  const t = useTranslations("nazar");
  const label = t("play.sim3d");
  const wrap = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one world per plan; reducedMotion is read at creation
  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    // A fresh canvas per mount: a canvas whose context was released cannot give a new one (StrictMode remounts).
    const el = document.createElement("canvas");
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", label);
    el.style.cssText = "width:100%;height:100%;display:block";
    box.prepend(el);
    let world: World | RichWorld;
    try {
      const opts = { reducedMotion, lite: isLite() };
      const theme = RICH[plan.row.id];
      world = theme ? new RichWorld(el, plan, opts, theme) : new World(el, plan, opts);
    } catch {
      el.remove();
      onFail();
      return;
    }
    const fit = () => world.resize(box.clientWidth, box.clientHeight);
    fit();
    const ro = new ResizeObserver(() => {
      fit();
      last = Number.NaN;
    });
    ro.observe(box);
    const lost = (e: Event) => {
      e.preventDefault();
      onFail();
    };
    el.addEventListener("webglcontextlost", lost);
    let last = Number.NaN;
    let raf = 0;
    const loop = () => {
      const mt = mtRef.current;
      if (mt !== last) {
        last = mt;
        world.update(mt);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("webglcontextlost", lost);
      world.dispose();
      el.remove();
    };
  }, [plan, mtRef, onFail, label]);

  return (
    <div ref={wrap} className="mg-clip mg-clip--scene3d" data-testid="scene3d-clip">
      <span
        className="mg-clip__label"
        style={{ top: "var(--md-space-2)", bottom: "auto", zIndex: 1, pointerEvents: "none" }}
      >
        {t("play.sim3d")}
      </span>
    </div>
  );
}

function isLite(): boolean {
  try {
    return (
      window.matchMedia("(prefers-reduced-data: reduce)").matches ||
      (navigator.hardwareConcurrency ?? 8) <= 2
    );
  } catch {
    return false;
  }
}

/** True when this browser can create a WebGL context and the 3D scene is not switched off (?scene3d=0). */
export function sceneAvailable(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("scene3d") === "0") return false;
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}
