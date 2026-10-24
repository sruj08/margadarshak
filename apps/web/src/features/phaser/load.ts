/**
 * The only place that imports Phaser (FRONTEND §10.2, §18): a dynamic `import("phaser")`, so the
 * engine is its own lazy chunk, requested when a canvas game mounts and cached once for every sim.
 * Nothing imports this file at module level outside a mount effect.
 */
export type PhaserModule = typeof import("phaser");

let pending: Promise<PhaserModule> | null = null;

/** Records when the engine was requested, for the e2e smoke check and the spike overlay. */
function mark(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __mdPhaser?: { requestedAt: number } };
  w.__mdPhaser ??= { requestedAt: performance.now() };
}

function loaded(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __mdPhaser?: { requestedAt: number; loadedAt?: number } };
  if (w.__mdPhaser && w.__mdPhaser.loadedAt === undefined)
    w.__mdPhaser.loadedAt = performance.now();
}

export function loadPhaser(): Promise<PhaserModule> {
  if (pending === null) {
    mark();
    pending = import("phaser").then((P) => {
      loaded();
      return P;
    });
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
