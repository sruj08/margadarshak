/**
 * Blind Spot Part A scene (GAME_DESIGN §4.3): a stationary truck, bus or tanker at its seeded
 * orientation, the eight numbered spots and, after each commit, the four hatched no-zones and the
 * placed bike. Geometry from game-core (`vehicleZones`, `GAME_CONFIG`); state from the React flow
 * through `bridge.get()` each frame. Tapping near a spot picks it; with drag on (not tap-only) the
 * bike can be dragged anywhere and placed there.
 */
import type { VehicleType } from "@margdarshak/game-core/schema";
import { vehicleZones } from "@margdarshak/game-core/scoring";
import type { Vec2 } from "@margdarshak/game-core/sim";
import type { PhaserModule } from "@/features/phaser/load";
import { diagramFrame } from "../decision-variant/VehicleDiagram";
import { BIKE, geometryOf, type Spot } from "../geometry";
import { boxOf, COLOURS, drawEyeOff, drawZone, TEXT_STYLE } from "./draw";

export interface PartAState {
  selected: number | null;
  dragged: Vec2 | null;
  placed: Vec2 | null;
  placedVisible: boolean | null;
}

export interface PartABridge {
  type: VehicleType;
  thetaDeg: number;
  spots: readonly Spot[];
  dragEnabled: boolean;
  zoneLabel: string;
  get(): PartAState;
  onPick(n: number): void;
  onDrag(local: Vec2): void;
}

export const PART_A_SIZE = { width: 360, height: 420 } as const;

export function createPartAScene(
  P: PhaserModule,
  bridge: PartABridge,
): Phaser.Types.Scenes.SceneType {
  const { width: W, height: H } = PART_A_SIZE;
  const { c, scale: s } = diagramFrame(bridge.type, bridge.spots, bridge.thetaDeg, W, H);
  const theta = (bridge.thetaDeg * Math.PI) / 180;
  const lx = (x: number) => (x - c.x) * s;
  const ly = (y: number) => -(y - c.y) * s;
  /** Screen point → vehicle frame (inverse of the container transform). */
  const toLocal = (px: number, py: number): Vec2 => {
    const dx = px - W / 2;
    const dy = py - H / 2;
    const qx = dx * Math.cos(theta) - dy * Math.sin(theta);
    const qy = dx * Math.sin(theta) + dy * Math.cos(theta);
    return { x: qx / s + c.x, y: -qy / s + c.y };
  };

  class PartAScene extends P.Scene {
    private dyn!: Phaser.GameObjects.Graphics;
    private zonesLayer!: Phaser.GameObjects.Container;
    private last = "";
    private labels: Phaser.GameObjects.Text[] = [];

    constructor() {
      super({ key: "bs-part-a" });
    }

    create(): void {
      const root = this.add.container(W / 2, H / 2);
      root.setRotation(-theta);
      const { body, zones } = vehicleZones(bridge.type);
      const g = geometryOf(bridge.type);
      // Zones (hidden until a commit).
      const zg = this.add.graphics();
      const zoneParts: Phaser.GameObjects.GameObject[] = [zg];
      for (const z of zones) {
        const b = boxOf(z, (x, y) => [lx(x), ly(y)]);
        drawZone(zg, b);
        drawEyeOff(zg, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2 - 6);
        const label = this.add.text((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2 + 8, bridge.zoneLabel, {
          ...TEXT_STYLE,
          fontSize: "10px",
        });
        label.setOrigin(0.5).setRotation(theta);
        zoneParts.push(label);
      }
      this.zonesLayer = this.add.container(0, 0, zoneParts);
      this.zonesLayer.setVisible(false);
      // Vehicle body, cab and a front arrow.
      const vg = this.add.graphics();
      const bb = boxOf(body, (x, y) => [lx(x), ly(y)]);
      vg.fillStyle(COLOURS.body, 1).fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
      vg.lineStyle(1, COLOURS.white, 1).strokeRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
      vg.fillStyle(COLOURS.cab, 1).fillRect(
        bb.x0,
        bb.y0,
        bb.x1 - bb.x0,
        Math.min(2.2, g.lengthM / 4) * s,
      );
      vg.fillStyle(COLOURS.white, 1).fillTriangle(
        lx(0),
        ly(0) - 12,
        lx(0) - 6,
        ly(0) - 3,
        lx(0) + 6,
        ly(0) - 3,
      );
      // Spot numbers (upright whatever the orientation).
      const labels = bridge.spots.map((sp) =>
        this.add
          .text(lx(sp.x), ly(sp.y), String(sp.n), {
            ...TEXT_STYLE,
            fontSize: "13px",
            fontStyle: "bold",
          })
          .setOrigin(0.5)
          .setRotation(theta),
      );
      this.dyn = this.add.graphics();
      this.labels = labels;
      root.add([this.zonesLayer, vg, this.dyn, ...labels]);
      root.bringToTop(this.dyn);
      for (const l of labels) root.bringToTop(l);

      const handle = (px: number, py: number, start: boolean) => {
        const p = toLocal(px, py);
        if (start) {
          const near = bridge.spots.find(
            (sp) => Math.hypot((sp.x - p.x) * s, (sp.y - p.y) * s) <= 18,
          );
          if (near) {
            bridge.onPick(near.n);
            return;
          }
        }
        if (bridge.dragEnabled) bridge.onDrag(p);
      };
      this.input.on("pointerdown", (ptr: Phaser.Input.Pointer) => handle(ptr.x, ptr.y, true));
      this.input.on("pointermove", (ptr: Phaser.Input.Pointer) => {
        if (ptr.isDown && bridge.dragEnabled) handle(ptr.x, ptr.y, false);
      });
    }

    override update(): void {
      const st = bridge.get();
      const key = JSON.stringify(st);
      if (key === this.last) return;
      this.last = key;
      this.zonesLayer.setVisible(st.placed !== null);
      const d = this.dyn;
      d.clear();
      // Once the zones are shown, the spots step aside so the zone words stay readable.
      for (const l of this.labels) l.setVisible(st.placed === null);
      for (const sp of st.placed === null ? bridge.spots : []) {
        const on = st.selected === sp.n;
        d.fillStyle(on ? COLOURS.pick : COLOURS.ink, 1).fillCircle(lx(sp.x), ly(sp.y), 11);
        d.lineStyle(on ? 3 : 1.5, on ? COLOURS.white : COLOURS.line, 1).strokeCircle(
          lx(sp.x),
          ly(sp.y),
          11,
        );
      }
      const bike = st.placed ?? st.dragged;
      if (bike) {
        const colour =
          st.placed === null ? COLOURS.rider : st.placedVisible ? COLOURS.ok : COLOURS.riderInZone;
        const w = 2 * BIKE.halfWidthM * s;
        const h = 2 * BIKE.halfLengthM * s;
        d.fillStyle(colour, 1).fillRect(lx(bike.x) - w / 2, ly(bike.y) - h / 2, w, h);
        d.lineStyle(1.5, COLOURS.white, 1).strokeRect(lx(bike.x) - w / 2, ly(bike.y) - h / 2, w, h);
        if (st.placed !== null && !st.placedVisible)
          drawEyeOff(d, lx(bike.x), ly(bike.y) - h / 2 - 9);
      }
    }
  }
  return PartAScene;
}
