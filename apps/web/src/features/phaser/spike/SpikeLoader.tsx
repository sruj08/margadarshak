"use client";

import dynamic from "next/dynamic";

/** The spike (and Phaser) load only after mount, never in the route's first load. */
const PhaserSpike = dynamic(() => import("./PhaserSpike").then((m) => m.PhaserSpike), {
  ssr: false,
  loading: () => <p role="status">Loading the spike…</p>,
});

export function SpikeLoader() {
  return <PhaserSpike />;
}
