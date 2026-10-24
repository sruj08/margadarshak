import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SpotLight,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { Adaptive } from "./adaptive";
import type { ScenePlan } from "./choreo";
import { animate, ball, box, cone, makeModel } from "./models";

type Look = {
  sky: number;
  fog: number;
  fogFar: number;
  sun: number;
  sunColor: number;
  ambient: number;
  ground: number;
  lights: boolean;
};

const LOOK: Record<string, Look> = {
  day: {
    sky: 0x8ec5ee,
    fog: 0xbcd9ea,
    fogFar: 170,
    sun: 2.4,
    sunColor: 0xfff4dc,
    ambient: 0.9,
    ground: 0x6f8f55,
    lights: false,
  },
  dusk: {
    sky: 0xe8935c,
    fog: 0xc98a72,
    fogFar: 120,
    sun: 1.0,
    sunColor: 0xffb070,
    ambient: 0.55,
    ground: 0x4c5a40,
    lights: true,
  },
  dawn: {
    sky: 0xf1c7a0,
    fog: 0xe3d3c2,
    fogFar: 95,
    sun: 1.2,
    sunColor: 0xffd7a8,
    ambient: 0.7,
    ground: 0x5d7b4c,
    lights: true,
  },
};

const STYLE: Record<string, "urban" | "kerala" | "rural" | "hill" | "town"> = {
  metro_arterial: "urban",
  metro_residential: "urban",
  kerala_town: "kerala",
  kerala_highway: "kerala",
  kerala_rural: "rural",
  jk_hill_road: "hill",
  jk_town: "town",
  small_town_market: "town",
  school_zone: "town",
};

const hash = (n: number) => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function roadTexture(plan: ScenePlan, wet: boolean): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const x = c.getContext("2d") as CanvasRenderingContext2D;
  x.fillStyle = wet ? "#2b2e33" : "#3b3d41";
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 700; i++) {
    x.fillStyle = `rgba(${hash(i) > 0.5 ? 255 : 0},${hash(i) > 0.5 ? 255 : 0},${hash(i) > 0.5 ? 255 : 0},0.05)`;
    x.fillRect(hash(i + 900) * 256, hash(i + 1700) * 256, 2, 2);
  }
  const g = plan.geometry;
  const px = (m: number) => ((m + g.h) / (2 * g.h)) * 256;
  x.fillStyle = "#ece9df";
  const dash = (m: number, w: number) => x.fillRect(px(m) - w, 0, w * 2, 130);
  if (g.median) {
    dash(-g.lane, 2.5);
    dash(g.lane, 2.5);
  } else dash(0, 3);
  x.fillRect(px(-g.h) + 4, 0, 4, 256);
  x.fillRect(px(g.h) - 8, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

const SPACING = 13;
const SLOTS = 22;

/**
 * The scene for one clip: a road that scrolls past a fixed camera, recycled roadside scenery,
 * weather, and the plan's actors. `update(t)` is a pure function of media time, so a paused clip
 * is a still frame and a replayed session shows the same pictures.
 */
export class World {
  readonly renderer: WebGLRenderer;
  private readonly adapt: Adaptive;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly road: Mesh;
  private readonly roadTex: CanvasTexture;
  private readonly rain: LineSegments | null;
  private readonly actors = new Map<string, { g: Group; kind: string }>();
  private readonly left: Group[] = [];
  private readonly right: Group[] = [];
  private readonly cockpit = new Group();
  private readonly wiper: Group | null = null;
  private readonly follow: Mesh[] = [];
  private readonly style: "urban" | "kerala" | "rural" | "hill" | "town";
  private readonly sun: DirectionalLight;
  private readonly head: SpotLight | null;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly plan: ScenePlan,
    private readonly opts: { reducedMotion: boolean; lite: boolean },
  ) {
    const row = plan.row;
    const look = LOOK[row.timeOfDay] ?? (LOOK["day"] as Look);
    const rain = row.weather === "rain";
    const dim = rain || row.weather === "overcast";
    this.style = STYLE[row.setting] ?? "town";
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: !opts.lite,
      powerPreference: "low-power",
    });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.adapt = new Adaptive(
      this.renderer,
      0.5,
      Math.min(window.devicePixelRatio || 1, 1.5),
      opts.lite ? 0.75 : 1,
    );
    const sky = new Color(look.sky);
    const fog = new Color(look.fog);
    if (dim) {
      sky.lerp(new Color(0x8d98a3), 0.7);
      fog.lerp(new Color(0x9aa3ab), 0.7);
    }
    this.scene.background = sky;
    this.scene.fog = new Fog(fog, 18, rain ? 85 : row.weather === "haze" ? 80 : look.fogFar);
    this.camera = new PerspectiveCamera(62, 16 / 9, 0.1, 400);
    this.scene.add(this.camera);

    this.scene.add(new HemisphereLight(0xdfeaff, 0x5a6048, look.ambient * (dim ? 1.1 : 1)));
    this.scene.add(new AmbientLight(0xffffff, 0.15));
    this.sun = new DirectionalLight(look.sunColor, look.sun * (dim ? 0.45 : 1));
    this.sun.position.set(-30, 40, 20);
    this.scene.add(this.sun);
    this.head = look.lights ? new SpotLight(0xfff0cf, 120, 60, 0.5, 0.6, 1.5) : null;
    if (this.head) {
      this.head.position.set(0, 0.9, 0);
      this.head.target.position.set(0, 0, -20);
      this.camera.add(this.head, this.head.target);
    }

    // Ground and road follow the camera; their texture scrolls to give the motion.
    const ground = new Mesh(
      new PlaneGeometry(600, 600),
      new MeshStandardMaterial({ color: dim ? 0x59704a : look.ground, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.scene.add(ground);
    this.follow.push(ground);
    const g = plan.geometry;
    this.roadTex = roadTexture(plan, rain);
    this.roadTex.repeat.set(1, 30);
    this.roadTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.road = new Mesh(
      new PlaneGeometry(g.h * 2, 240),
      new MeshStandardMaterial({
        map: this.roadTex,
        roughness: rain ? 0.3 : 0.9,
        metalness: rain ? 0.35 : 0,
      }),
    );
    this.road.rotation.x = -Math.PI / 2;
    this.scene.add(this.road);
    this.follow.push(this.road);
    // Footpaths beside the carriageway.
    for (const s of [-1, 1] as const) {
      const fp = new Mesh(
        new PlaneGeometry(6, 240),
        new MeshStandardMaterial({ color: 0x8d8b84, roughness: 1 }),
      );
      fp.rotation.x = -Math.PI / 2;
      fp.position.set(s * (g.h + 3), 0.1, 0);
      this.scene.add(fp);
      this.follow.push(fp);
      const kerb = new Mesh(
        new BoxGeometry(0.3, 0.2, 240),
        new MeshStandardMaterial({ color: 0xb9b6ac }),
      );
      kerb.position.set(s * g.h, 0.1, 0);
      this.scene.add(kerb);
      this.follow.push(kerb);
    }
    if (g.median) {
      const m = new Mesh(
        new BoxGeometry(1.2, 0.35, 240),
        new MeshStandardMaterial({ color: 0xa8a69e }),
      );
      m.position.set(0, 0.17, 0);
      this.scene.add(m);
      this.follow.push(m);
      const shrubs = new Mesh(
        new BoxGeometry(0.9, 0.5, 240),
        new MeshStandardMaterial({ color: 0x4d7a3a }),
      );
      shrubs.position.set(0, 0.5, 0);
      this.scene.add(shrubs);
      this.follow.push(shrubs);
    }
    for (const gap of plan.gaps) {
      const side = new Mesh(
        new PlaneGeometry(14, Math.abs(gap.z0 - gap.z1)),
        new MeshStandardMaterial({ color: 0x3b3d41, roughness: 0.9 }),
      );
      side.rotation.x = -Math.PI / 2;
      side.position.set(gap.side * (g.h + 7), 0.06, (gap.z0 + gap.z1) / 2);
      this.scene.add(side);
    }

    // Recycled roadside scenery.
    for (let i = 0; i < SLOTS; i++) {
      this.left.push(this.slot(-1));
      this.right.push(this.slot(1));
    }
    // Distant hills or skyline so the horizon is not empty.
    this.horizon();

    this.rain = rain ? this.makeRain(opts.lite ? 260 : 520) : null;

    // Cockpit seen from the learner's seat.
    this.camera.add(this.cockpit);
    this.cockpit.position.set(0, 0, 0);
    if (row.pov === "2W") {
      const bar = box(this.cockpit, 0.85, 0.035, 0.035, 0x1b1b1d, 0, -0.34, -0.62);
      bar.rotation.z = 0.02;
      box(this.cockpit, 0.1, 0.1, 0.14, 0x1b1b1d, -0.46, -0.34, -0.62);
      box(this.cockpit, 0.1, 0.1, 0.14, 0x1b1b1d, 0.46, -0.34, -0.62);
      box(this.cockpit, 0.16, 0.1, 0.02, 0x2a3138, -0.42, -0.12, -0.6);
      box(this.cockpit, 0.16, 0.1, 0.02, 0x2a3138, 0.42, -0.12, -0.6);
      box(this.cockpit, 0.3, 0.12, 0.08, 0x1a1a1c, 0, -0.3, -0.6);
    } else {
      box(this.cockpit, 2.4, 0.3, 0.9, 0x1d1f22, 0, -0.7, -0.8);
      box(this.cockpit, 0.5, 0.05, 0.4, 0x2b2e33, 0, -0.42, -0.62);
      if (rain) {
        const w = new Group();
        w.position.set(-0.3, -0.42, -0.85);
        box(w, 0.9, 0.025, 0.025, 0x111111, 0.45, 0, 0);
        this.cockpit.add(w);
        this.wiper = w;
      }
    }
    this.cockpit.traverse((o) => {
      if (o instanceof Mesh) o.renderOrder = 10;
    });
    this.update(0);
  }

  private slot(side: -1 | 1): Group {
    const g = new Group();
    this.scene.add(g);
    g.userData["side"] = side;
    return g;
  }

  private dress(g: Group, side: -1 | 1, idx: number) {
    if (g.userData["idx"] === idx) return;
    g.userData["idx"] = idx;
    for (const c of [...g.children]) g.remove(c);
    const r = hash(idx * 2 + (side > 0 ? 1 : 0));
    const r2 = hash(idx * 7 + 3 + (side > 0 ? 11 : 0));
    const h = this.plan.geometry.h;
    const edge = side * (h + 6.5 + r * 1.5);
    const style = this.style;
    const hue = [0xd9c9a8, 0xc9b6a0, 0xb8c4cc, 0xd8b4a0, 0xc2cfae, 0xe0d6c3, 0xa9a39a][
      Math.floor(r2 * 7)
    ] as number;
    if (style === "hill") {
      if (side < 0) {
        box(g, 1.2, 3 + r * 2, SPACING + 0.2, 0x7b746a, -h - 0.9, 1.6, 0);
        if (r > 0.45) cone(g, 1.2, 7 + r * 5, 0x2f5a3a, -h - 4 - r * 3, 4, 0);
      } else {
        box(g, 0.1, 0.5, SPACING, 0x9a9da1, h + 0.6, 0.45, 0);
        if (r > 0.3) cone(g, 1.4, 8 + r * 4, 0x2b5434, h + 6 + r * 6, 4.5, (r2 - 0.5) * 8);
      }
      return;
    }
    if (style === "rural") {
      if (side < 0) {
        box(g, 4, 0.05, SPACING, 0x7fae4e, -h - 6, 0.06, 0);
        if (r > 0.4) palm(g, -h - 2.5 - r * 2, 0);
      } else {
        box(g, 3, 0.4, SPACING, 0x6aa0c9, h + 2.5, 0.0, 0);
        if (r > 0.3) palm(g, h + 5, (r2 - 0.5) * 8);
      }
      return;
    }
    // Buildings (urban high, kerala and town low) with a gap between some.
    if (r > 0.12) {
      const floors = style === "urban" ? 3 + Math.floor(r2 * 6) : 1 + Math.floor(r2 * 2);
      const hgt = floors * 3.1;
      const depth = SPACING - 1.5;
      box(g, 8, hgt, depth, hue, edge + side * 4, hgt / 2, 0);
      for (let f = 0; f < floors; f++)
        box(g, 0.1, 1.2, depth * 0.6, 0x37424d, edge - side * 0.05, 1.9 + f * 3.1, 0);
      if (style !== "urban") {
        const roof = cone(
          g,
          5.8,
          1.8,
          style === "kerala" ? 0xa9482d : 0x8a8f95,
          edge + side * 4,
          hgt + 0.9,
          0,
        );
        roof.rotation.y = Math.PI / 4;
        box(
          g,
          2.2,
          0.12,
          depth * 0.8,
          [0xc0392b, 0x2e86c1, 0xd4a017, 0x2e8b57][Math.floor(r2 * 4)] as number,
          edge - side * 1.0,
          2.7,
          0,
        );
      }
    }
    if (style === "kerala" || style === "town") {
      if (r2 > 0.35) palm(g, side * (h + 3 + r), (r - 0.5) * 6);
    } else if (r2 > 0.4) {
      leafy(g, side * (h + 2.4), (r - 0.5) * 7);
    }
    // Roadside people and a lamp post, for scale and life.
    box(g, 0.14, 5.5, 0.14, 0x55585c, side * (h + 0.5), 2.8, SPACING * 0.4);
  }

  private horizon() {
    const mk = (x: number, z: number, w: number, h: number, c: number) => {
      const m = box(this.scene as unknown as Group, w, h, 30, c, x, h / 2, z);
      m.userData["horizon"] = true;
      this.follow.push(m);
    };
    if (this.style === "hill") {
      for (let i = 0; i < 8; i++) mk(-160 + i * 45, -230, 70, 40 + hash(i) * 55, 0x6d7f8e);
    } else {
      for (let i = 0; i < 9; i++)
        mk(-170 + i * 42, -230, 40, 12 + hash(i) * (this.style === "urban" ? 55 : 14), 0x8fa0ac);
    }
  }

  private makeRain(n: number): LineSegments {
    const pos = new Float32Array(n * 6);
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    const l = new LineSegments(
      geo,
      new LineBasicMaterial({ color: 0xcfd8e0, transparent: true, opacity: 0.45 }),
    );
    l.frustumCulled = false;
    this.scene.add(l);
    return l;
  }

  resize(w: number, h: number) {
    this.adapt.size(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  update(tMs: number) {
    const p = this.plan;
    const z = p.egoZ(tMs);
    const x = p.egoX(tMs);
    const sec = tMs / 1000;
    const sway = this.opts.reducedMotion ? 0 : 1;
    const speed = p.egoV(tMs);
    const bump = sway * Math.sin(sec * 9) * 0.004 * Math.min(1, speed / 6);
    const eye = p.row.pov === "2W" ? 1.28 : 1.12;
    this.camera.position.set(x + sway * Math.sin(sec * 0.7) * 0.03, eye + bump, z);
    this.camera.rotation.set(
      -0.025,
      sway * Math.sin(sec * 0.5) * 0.004,
      sway * Math.sin(sec * 0.7) * 0.004 * Math.min(1, speed / 6),
    );

    for (const f of this.follow) {
      f.position.z = f.userData["horizon"] ? z : z - (f.geometry instanceof PlaneGeometry ? 40 : 0);
    }
    this.road.position.set(0, 0.0, z - 60);
    // The plane is centred at z - 60 and its v axis runs towards -z, so the texture must move with -z/8.
    this.roadTex.offset.y = (60 - z) / 8;

    const base = Math.floor(z / SPACING);
    for (let i = 0; i < SLOTS; i++) {
      const idx = base - (i - 4);
      for (const [arr, side] of [
        [this.left, -1],
        [this.right, 1],
      ] as const) {
        const g = arr[i] as Group;
        const zz = idx * SPACING;
        const inGap = this.plan.gaps.some((q) => q.side === side && zz < q.z0 && zz > q.z1);
        g.visible = !inGap;
        if (!inGap) this.dress(g, side, idx);
        g.position.z = zz;
      }
    }

    // Actors.
    const live = new Set<string>();
    const poses = p.poses(tMs);
    for (const pose of poses) {
      const dz = pose.z - z;
      let a = this.actors.get(pose.id);
      if (!a) {
        a = { g: makeModel(pose.kind, hashId(pose.id), p.row.setting), kind: pose.kind };
        this.scene.add(a.g);
        this.actors.set(pose.id, a);
      }
      const near = dz < 12 && dz > -190;
      a.g.visible = near;
      live.add(pose.id);
      if (!near) continue;
      a.g.position.set(pose.x, 0, pose.z);
      a.g.rotation.y = pose.yaw;
      animate(a.g, pose, tMs, this.opts.reducedMotion && pose.v < 0.01);
    }

    if (this.wiper) this.wiper.rotation.z = Math.sin(sec * 3.2) * 0.9 + 0.9;
    if (this.rain) this.stepRain(sec, x, z, speed);
    this.renderer.render(this.scene, this.camera);
    this.adapt.tick();
  }

  private stepRain(sec: number, cx: number, cz: number, speed: number) {
    const attr = this.rain?.geometry.getAttribute("position") as BufferAttribute;
    const n = attr.count / 2;
    for (let i = 0; i < n; i++) {
      const fall = (sec * (9 + hash(i) * 3) + hash(i + 40) * 8) % 8;
      const x = cx + (hash(i + 80) - 0.5) * 22;
      const zz = cz - 2 - hash(i + 120) * 28;
      const y = 8 - fall;
      attr.setXYZ(i * 2, x, y, zz);
      attr.setXYZ(i * 2 + 1, x - 0.04, y + 0.35, zz + 0.12 + speed * 0.01);
    }
    attr.needsUpdate = true;
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        const m = o.material;
        for (const mm of Array.isArray(m) ? m : [m]) mm.dispose();
      }
    });
    this.roadTex.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

function hashId(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 97;
}

function palm(g: Group, x: number, z: number) {
  box(g, 0.28, 8, 0.28, 0x7a5c3a, x, 4, z).rotation.z = 0.06;
  for (let i = 0; i < 6; i++) {
    const leaf = box(g, 0.16, 0.05, 3.4, 0x3f8a3d, x, 8.2, z);
    leaf.rotation.y = (i / 6) * Math.PI * 2;
    leaf.rotation.x = 0.35;
    leaf.translateZ(-1.5);
  }
}
function leafy(g: Group, x: number, z: number) {
  box(g, 0.4, 3.4, 0.4, 0x6b4f33, x, 1.7, z);
  ball(g, 2.2, 0x4a8a3a, x, 4.4, z);
}
