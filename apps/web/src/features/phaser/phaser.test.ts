// @vitest-environment jsdom
import { createFixedStepLoop } from "@margdarshak/game-core/sim";
import { describe, expect, it, vi } from "vitest";
import { hasWebGL, resetWebGLProbe, watchContextLoss } from "./context-loss";

describe("WebGL context loss (FRONTEND §10.2)", () => {
  it("prevents the default on loss (so the browser may restore) and calls the handlers", () => {
    const canvas = document.createElement("canvas");
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const unbind = watchContextLoss(canvas, { onLost, onRestored });
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(onRestored).toHaveBeenCalledTimes(1);
    unbind();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("no WebGL in this browser: the probe says so (canvas games use their decision version)", () => {
    resetWebGLProbe();
    expect(hasWebGL()).toBe(false);
  });
});

describe("fixed-step logic is frame-rate independent (game-core loop, as PhaserMount drives it)", () => {
  it("40 fps and 20 fps frames issue the same logic steps for the same elapsed time", () => {
    const run = (frameMs: number) => {
      const loop = createFixedStepLoop({ hz: 60, maxStepsPerAdvance: 15 });
      let steps = 0;
      for (let t = 0; t < 10_000; t += frameMs) steps += loop.advance(frameMs).steps;
      return steps;
    };
    expect(run(50)).toBe(600);
    expect(run(25)).toBe(600);
    expect(run(10)).toBe(600);
  });
});
