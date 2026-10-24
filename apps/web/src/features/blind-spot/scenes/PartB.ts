/**
 * Blind Spot Part B scene (GAME_DESIGN §4.3): a top-down highway that follows the rider, the
 * scripted truck with its hatched no-zones, the left indicator (arrow plus the word, at most 2 Hz,
 * steady with reduced motion) and the rider, red-orange with an eye-off mark while in a zone. The
 * scene only draws `bridge.snapshot()`: the ride controller (stepped at 60 Hz by PhaserMount) owns
 * every position and every event.
 */
import { vehicleZones } from "@margdarshak/game-core/scoring";
import type { PhaserModule } from "@/features/phaser/load";
import { BIKE, type PartB } from "../geometry";
import type { RideSnapshot } from "../ride";
import { boxOf, COLOURS, drawEyeOff, drawZone, TEXT_STYLE } from "./draw";

export interface PartBBridge {
  spec: PartB;
  snapshot(): RideSnapshot;
  leftWord: string;
  youWord: string;
}

export const PART_B_SIZE = { width: 360, height: 420 } as const;
/** Metres of road in view and verge on each side [D]. */
const VIEW = { aheadM: 20, behindM: 6, vergeM: 1.2, riderAt: 0.75 } as const;

export function createPartBScene(
  P: PhaserModule,
  bridge: PartBBridge,
): Phaser.Types.Scenes.SceneType {
  const { width: W, height: H } = PART_B_SIZE;
  const roadW = bridge.spec.riderLaneLeftM + bridge.spec.laneWidthM;
  const s = Math.min(W / (roadW + 2 * VIEW.vergeM), H / (VIEW.aheadM + VIEW.behindM));
  const ox = (W - roadW * s) / 2;
  const sx = (lat: number) => ox + lat * s;

  class PartBScene extends P.Scene {
    private lines!: Phaser.GameObjects.Graphics;
    private truck!: Phaser.GameObjects.Container;
    private indicator!: Phaser.GameObjects.Container;
    private rider!: Phaser.GameObjects.Graphics;
    private youLabel!: Phaser.GameObjects.Text;

    constructor() {
      super({ key: "bs-part-b" });
    }

    create(): void {
      const bg = this.add.graphics();
      bg.fillStyle(COLOURS.grass, 1).fillRect(0, 0, W, H);
      bg.fillStyle(COLOURS.road, 1).fillRect(sx(0), 0, roadW * s, H);
      this.lines = this.add.graphics();
      // Truck: zones + body in the vehicle frame (x right, y forward → screen y up).
      const { body, zones } = vehicleZones(bridge.spec.vehicleType);
      const tg = this.add.graphics();
      for (const z of zones)
        drawZone(
          tg,
          boxOf(z, (x, y) => [x * s, -y * s]),
          6,
        );
      const bb = boxOf(body, (x, y) => [x * s, -y * s]);
      tg.fillStyle(COLOURS.body, 1).fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
      tg.fillStyle(COLOURS.cab, 1).fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, 2.2 * s);
      tg.lineStyle(1, COLOURS.white, 1).strokeRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
      const ig = this.add.graphics();
      ig.fillStyle(COLOURS.pick, 1).fillTriangle(-6, 0, 4, -6, 4, 6);
      const iword = this.add
        .text(8, 0, bridge.leftWord, {
          ...TEXT_STYLE,
          fontSize: "12px",
          color: "#000000",
          backgroundColor: "#F0E442",
        })
        .setOrigin(0, 0.5);
      this.indicator = this.add.container(bb.x0 - 4, bb.y0 + 14, [ig, iword]);
      this.truck = this.add.container(0, 0, [tg, this.indicator]);
      this.rider = this.add.graphics();
      this.youLabel = this.add
        .text(0, 0, bridge.youWord, { ...TEXT_STYLE, fontSize: "11px" })
        .setOrigin(0.5, 0);
    }

    override update(time: number): void {
      const snap = bridge.snapshot();
      const reduced = this.registry.get("reducedMotion") === true;
      const riderY = H * VIEW.riderAt;
      const sy = (prog: number) => riderY - (prog - snap.rider.prog) * s;
      // Lane line between the truck's lane and yours, dashed every 6 m, scrolling with progress.
      const l = this.lines;
      l.clear();
      l.fillStyle(COLOURS.line, 0.9);
      const topProg = snap.rider.prog + riderY / s;
      for (let m = Math.floor((topProg - H / s) / 6) * 6; m <= topProg; m += 6) {
        l.fillRect(sx(snap.road.laneLeftM) - 1, sy(m) - 3 * s, 2, 3 * s);
      }
      l.fillStyle(COLOURS.line, 0.25);
      for (const k of [1, 2]) {
        const x = sx(snap.road.laneLeftM + (snap.road.laneWidthM * k) / 3);
        l.fillRect(x - 0.5, 0, 1, H);
      }
      // Truck.
      this.truck.setVisible(snap.truck.present);
      this.truck.setPosition(sx(snap.truck.lat), sy(snap.truck.prog));
      const blinkOn = reduced || Math.floor(time / 250) % 2 === 0; // 2 Hz, photosafe
      this.indicator.setVisible(snap.truck.indicating && blinkOn);
      // Rider.
      const r = this.rider;
      r.clear();
      const x = sx(snap.rider.lat);
      const w = 2 * BIKE.halfWidthM * s;
      const h = 2 * BIKE.halfLengthM * s;
      r.fillStyle(snap.zone === null ? COLOURS.rider : COLOURS.riderInZone, 1);
      r.fillRect(x - w / 2, riderY - h / 2, w, h);
      r.lineStyle(1.5, COLOURS.white, 1).strokeRect(x - w / 2, riderY - h / 2, w, h);
      if (snap.zone !== null) drawEyeOff(r, x, riderY - h / 2 - 9);
      this.youLabel.setPosition(x, riderY + h / 2 + 2);
    }
  }
  return PartBScene;
}
