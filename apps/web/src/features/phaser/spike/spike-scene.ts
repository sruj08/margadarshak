/**
 * MD-229 spike scene: the same drawing load as Blind Spot Part B (road, lane dashes, a truck with
 * four hatched no-zones, a blinking indicator, the rider) plus N traffic vehicles, so the frame
 * rate can be measured with more on screen than the real game ever draws. Positions are stepped at
 * 60 Hz by the mount's fixed-step loop (game-core) from a seeded mulberry32 stream.
 */
import { vehicleZones } from "@margdarshak/game-core/scoring";
import { mulberry32 } from "@margdarshak/game-core/sim";
import { boxOf, COLOURS, drawZone, TEXT_STYLE } from "@/features/blind-spot/scenes/draw";
import type { PhaserModule } from "../load";

export const SPIKE_SIZE = { width: 360, height: 420 } as const;
const ROAD_M = 10.5;
const LANES = 3;

interface Car {
  lane: number;
  y: number;
  v: number;
  len: number;
}

export interface SpikeSim {
  cars: Car[];
  scroll: number;
  step(stepMs: number): void;
}

/** The spike's world: N cars on three lanes, scrolling at a fixed speed (m and m/s). */
export function createSpikeSim(n: number, seed = 229): SpikeSim {
  const rng = mulberry32(seed);
  const viewM = 40;
  const cars: Car[] = Array.from({ length: n }, () => ({
    lane: Math.floor(rng() * LANES),
    y: rng() * viewM,
    v: 2 + rng() * 6,
    len: 4 + rng() * 6,
  }));
  return {
    cars,
    scroll: 0,
    step(stepMs: number) {
      const dt = stepMs / 1000;
      this.scroll += 8 * dt;
      for (const c of this.cars) {
        c.y += c.v * dt;
        if (c.y > viewM + c.len) c.y -= viewM + 2 * c.len;
      }
    },
  };
}

export function createSpikeScene(P: PhaserModule, sim: SpikeSim): Phaser.Types.Scenes.SceneType {
  const { width: W, height: H } = SPIKE_SIZE;
  const s = W / (ROAD_M + 2);
  const ox = s;
  class SpikeScene extends P.Scene {
    private dashes!: Phaser.GameObjects.Graphics;
    private carObjs: Phaser.GameObjects.Container[] = [];
    private indicator!: Phaser.GameObjects.Graphics;

    constructor() {
      super({ key: "md229-spike" });
    }

    create(): void {
      const bg = this.add.graphics();
      bg.fillStyle(COLOURS.grass, 1).fillRect(0, 0, W, H);
      bg.fillStyle(COLOURS.road, 1).fillRect(ox, 0, ROAD_M * s, H);
      this.dashes = this.add.graphics();
      for (const c of sim.cars) {
        const g = this.add.graphics();
        g.fillStyle(COLOURS.cab, 1).fillRect(-0.9 * s, 0, 1.8 * s, c.len * s);
        g.lineStyle(1, COLOURS.white, 0.8).strokeRect(-0.9 * s, 0, 1.8 * s, c.len * s);
        this.carObjs.push(this.add.container(0, 0, [g]));
      }
      // The Blind Spot truck with its zones, as Part B draws it.
      const { body, zones } = vehicleZones("truck");
      const tg = this.add.graphics();
      for (const z of zones)
        drawZone(
          tg,
          boxOf(z, (x, y) => [x * s, -y * s]),
          6,
        );
      const bb = boxOf(body, (x, y) => [x * s, -y * s]);
      tg.fillStyle(COLOURS.body, 1).fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
      this.add.container(ox + 2 * s, H * 0.35, [tg]);
      this.indicator = this.add.graphics();
      this.indicator.fillStyle(COLOURS.pick, 1).fillTriangle(0, 0, 10, -6, 10, 6);
      this.indicator.setPosition(ox + 0.4 * s, H * 0.35 + 10);
      const rider = this.add.graphics();
      rider.fillStyle(COLOURS.rider, 1).fillRect(-0.4 * s, -1 * s, 0.8 * s, 2 * s);
      rider.setPosition(ox + 5.25 * s, H * 0.75);
      this.add.text(8, 8, "MD-229 spike", { ...TEXT_STYLE, fontSize: "11px" });
    }

    override update(time: number): void {
      const d = this.dashes;
      d.clear();
      d.fillStyle(COLOURS.line, 0.9);
      const off = (sim.scroll % 6) * s;
      for (let k = 1; k < LANES; k++) {
        const x = ox + (ROAD_M * k * s) / LANES;
        for (let y = -6 * s + off; y < H; y += 6 * s) d.fillRect(x - 1, y, 2, 3 * s);
      }
      sim.cars.forEach((c, i) => {
        const x = ox + ((c.lane + 0.5) * ROAD_M * s) / LANES;
        this.carObjs[i]?.setPosition(x, H - c.y * s);
      });
      this.indicator.setVisible(Math.floor(time / 250) % 2 === 0);
    }
  }
  return SpikeScene;
}
