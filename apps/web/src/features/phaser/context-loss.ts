/**
 * WebGL context loss (FRONTEND §10.2). A phone can drop the GPU context at any time (memory
 * pressure, a call, the app switcher). Phaser 4 stops rendering for good on `webglcontextlost`, so
 * the mount pauses the simulation, shows "Tap to continue" and, on that tap, builds a fresh canvas.
 * The game state lives outside Phaser (game-core sim + the game's controller), so nothing is lost.
 */
export interface ContextLossHandlers {
  onLost(): void;
  onRestored?(): void;
}

/** Listens for context loss on a canvas; returns the unbind function. */
export function watchContextLoss(canvas: HTMLCanvasElement, h: ContextLossHandlers): () => void {
  const lost = (e: Event) => {
    // Tells the browser we intend to recover, so it may fire `webglcontextrestored`.
    e.preventDefault();
    h.onLost();
  };
  const restored = () => h.onRestored?.();
  canvas.addEventListener("webglcontextlost", lost, false);
  canvas.addEventListener("webglcontextrestored", restored, false);
  return () => {
    canvas.removeEventListener("webglcontextlost", lost, false);
    canvas.removeEventListener("webglcontextrestored", restored, false);
  };
}

let webglCache: boolean | null = null;

/**
 * True when this browser can create a WebGL context. Without one, canvas games fall back to their
 * DOM decision version (GAME_DESIGN §1.3, EC-19) and Phaser is never requested.
 */
export function hasWebGL(): boolean {
  if (webglCache !== null) return webglCache;
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    webglCache = gl !== null && gl !== undefined;
    (gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglCache = false;
  }
  return webglCache;
}

/** Test hook: forget the cached WebGL probe. */
export function resetWebGLProbe(): void {
  webglCache = null;
}
