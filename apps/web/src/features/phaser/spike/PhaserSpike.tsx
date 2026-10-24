"use client";

import "../phaser.css";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhaserModule } from "../load";
import { PhaserMount } from "../PhaserMount";
import { createSpikeScene, createSpikeSim, SPIKE_SIZE, type SpikeSim } from "./spike-scene";

/** One measurement of the spike (written to the page and to `window.__mdSpike`). */
export interface SpikeResult {
  cars: number;
  seconds: number;
  renderer: string;
  frames: number;
  fpsAvg: number;
  fpsPhaser: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameMaxMs: number;
  /** Share of frames slower than 33.4 ms (below 30 fps). */
  slowFramePct: number;
  longTasks: number;
  longTaskMs: number;
  longTaskMaxMs: number;
  /** From `import("phaser")` to the module resolving, and from mount to Phaser READY. */
  phaserLoadMs: number | null;
  bootMs: number | null;
  /** Scripts fetched after the engine was requested (bytes on the wire / decoded). */
  chunkTransferKb: number | null;
  chunkDecodedKb: number | null;
  logicSteps: number;
  device: { dpr: number; viewport: string; cores: number | null; memoryGb: number | null };
}

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * MD-229: Phaser 4 on a low-end phone. Mounts a Blind-Spot-equivalent scene through the real
 * `PhaserMount` (lazy engine, fixed 60 Hz logic) and measures frame times (rAF), Phaser's own fps,
 * long tasks (PerformanceObserver) and the engine chunk's load. `?cars=N&seconds=S&auto=1` runs one
 * measurement after a 2 s warm-up. Dev route only; English only.
 */
export function PhaserSpike() {
  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const cars = Math.max(0, Math.min(200, Number(params?.get("cars") ?? 24) || 0));
  const seconds = Math.max(2, Math.min(60, Number(params?.get("seconds") ?? 10) || 10));
  const auto = params?.get("auto") === "1";
  const sim = useRef<SpikeSim>(createSpikeSim(cars));
  const steps = useRef(0);
  const driver = useRef({
    step: (ms: number) => {
      steps.current += 1;
      sim.current.step(ms);
    },
  });
  const scenes = useRef((P: PhaserModule) => [createSpikeScene(P, sim.current)]);
  const game = useRef<{ g: Phaser.Game; P: PhaserModule } | null>(null);
  const mountedAt = useRef(performance.now());
  const [boot, setBoot] = useState<number | null>(null);
  const [live, setLive] = useState({ fps: 0, longTasks: 0 });
  const [result, setResult] = useState<SpikeResult | null>(null);
  const [running, setRunning] = useState(false);
  const longTasks = useRef<{ start: number; dur: number }[]>([]);

  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          longTasks.current.push({ start: e.startTime, dur: e.duration });
      });
      po.observe({ type: "longtask", buffered: true });
      return () => po.disconnect();
    } catch {
      return;
    }
  }, []);

  // Live fps readout (1 s windows of rAF frames).
  useEffect(() => {
    let n = 0;
    let t0 = performance.now();
    let h = 0;
    const tick = (now: number) => {
      n += 1;
      if (now - t0 >= 1000) {
        setLive({ fps: r1((n * 1000) / (now - t0)), longTasks: longTasks.current.length });
        n = 0;
        t0 = now;
      }
      h = requestAnimationFrame(tick);
    };
    h = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(h);
  }, []);

  const measure = useCallback(() => {
    if (running || !game.current) return;
    setRunning(true);
    const { g, P } = game.current;
    const frames: number[] = [];
    const fpsSamples: number[] = [];
    const start = performance.now();
    const stepsAt = steps.current;
    let last = start;
    const tick = (now: number) => {
      frames.push(now - last);
      last = now;
      fpsSamples.push(g.loop.actualFps);
      if (now - start < seconds * 1000) requestAnimationFrame(tick);
      else finish(now);
    };
    const finish = (end: number) => {
      const lt = longTasks.current.filter((e) => e.start >= start && e.start <= end);
      const req = (window as unknown as { __mdPhaser?: { requestedAt: number; loadedAt?: number } })
        .__mdPhaser;
      const res = performance
        .getEntriesByType("resource")
        .filter(
          (e) =>
            req !== undefined &&
            e.startTime >= req.requestedAt - 1 &&
            (e as PerformanceResourceTiming).initiatorType === "script",
        ) as PerformanceResourceTiming[];
      const nav = navigator as Navigator & { deviceMemory?: number };
      const out: SpikeResult = {
        cars,
        seconds,
        renderer: g.renderer.type === P.WEBGL ? "WebGL" : "Canvas",
        frames: frames.length,
        fpsAvg: r1((frames.length * 1000) / (end - start)),
        fpsPhaser: r1(fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, fpsSamples.length)),
        frameP50Ms: r1(pct(frames, 50)),
        frameP95Ms: r1(pct(frames, 95)),
        frameMaxMs: r1(Math.max(0, ...frames)),
        slowFramePct: r1(
          (100 * frames.filter((f) => f > 33.4).length) / Math.max(1, frames.length),
        ),
        longTasks: lt.length,
        longTaskMs: Math.round(lt.reduce((a, e) => a + e.dur, 0)),
        longTaskMaxMs: Math.round(Math.max(0, ...lt.map((e) => e.dur))),
        phaserLoadMs:
          req?.loadedAt !== undefined ? Math.round(req.loadedAt - req.requestedAt) : null,
        bootMs: boot,
        chunkTransferKb: res.length ? r1(res.reduce((a, e) => a + e.transferSize, 0) / 1024) : null,
        chunkDecodedKb: res.length
          ? r1(res.reduce((a, e) => a + e.decodedBodySize, 0) / 1024)
          : null,
        logicSteps: steps.current - stepsAt,
        device: {
          dpr: window.devicePixelRatio,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          cores: navigator.hardwareConcurrency ?? null,
          memoryGb: nav.deviceMemory ?? null,
        },
      };
      (window as unknown as { __mdSpike?: SpikeResult }).__mdSpike = out;
      setResult(out);
      setRunning(false);
    };
    requestAnimationFrame(tick);
  }, [running, seconds, cars, boot]);

  const onReady = useCallback((g: Phaser.Game, P: PhaserModule) => {
    game.current = { g, P };
    const req = (window as unknown as { __mdPhaser?: { requestedAt: number; loadedAt?: number } })
      .__mdPhaser;
    if (req && req.loadedAt === undefined) req.loadedAt = performance.now();
    setBoot(Math.round(performance.now() - mountedAt.current));
  }, []);

  useEffect(() => {
    if (!auto || boot === null) return;
    const h = setTimeout(measure, 2000);
    return () => clearTimeout(h);
  }, [auto, boot, measure]);

  return (
    <div className="ph-spike" data-testid="phaser-spike">
      <PhaserMount
        scenes={scenes.current}
        width={SPIKE_SIZE.width}
        height={SPIKE_SIZE.height}
        driver={driver.current}
        paused={false}
        reducedMotion={false}
        label="Phaser spike scene: a road with a truck, its blind zones and moving traffic"
        lostLine="The graphics context was lost."
        continueLabel="Tap to continue"
        loadingLabel="Loading Phaser"
        onReady={onReady}
      />
      <p data-testid="spike-live">
        {`${cars} cars · live ${live.fps} fps · long tasks so far ${live.longTasks} · boot ${boot ?? "…"} ms`}
      </p>
      <button
        type="button"
        className="ph-btn ph-btn--primary"
        onClick={measure}
        disabled={running || boot === null}
        data-testid="spike-measure"
      >
        {running ? `Measuring ${seconds} s…` : `Measure ${seconds} s`}
      </button>
      <p className="mg-note mg-note--ink">
        {"Try ?cars=8, ?cars=24 or ?cars=60. Real Blind Spot draws one truck and the rider."}
      </p>
      {result ? (
        <pre className="ph-spike__out" data-testid="spike-result">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
