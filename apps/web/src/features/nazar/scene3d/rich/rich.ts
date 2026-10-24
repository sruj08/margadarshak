import {
  ACESFilmicToneMapping,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  type Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Adaptive } from "../adaptive";
import { type ScenePlan, smooth } from "../choreo";
import { animate, box } from "../models";
import { makeRichModel } from "./models";
import {
  asphaltTexture,
  bushCard,
  cloudCard,
  grassTexture,
  rockTexture,
  stoneTexture,
  tuftCard,
} from "./textures";
import { frondTexture, leafClusterTexture, palmFrondTexture } from "./textures2";
import { leafTreeGeometry, palmGeometry, pineGeometry } from "./trees";

/**
 * The showcase renderer for two scenes (SCN-009 hill road, SCN-010 Kerala dawn). The recipe, after
 * slowroads.io: rolling terrain with a bending road, grass and foliage from thousands of cheap
 * instanced cards, real 3D trees built from textured quads, soft low-contrast light, layered
 * distance haze, painted textures, glossy rounded vehicles and one real shadow.
 *
 * It is built for weak GPUs: Lambert materials, no MSAA, no real shadows from foliage, vegetation
 * cut into 64 m chunks that are frustum- and distance-culled, and an adaptive render resolution.
 * The staged hazard still runs on the straight logical road; the picture is bent by `bend(z)` on
 * the way to the screen, so hazard timing and distances are identical to the plain renderer.
 */
export interface Theme {
  kind: "hill" | "paddy";
  skyTop: number;
  skyHorizon: number;
  fogDensity: number;
  sun: number;
  sunPower: number;
  /** Direction towards the sun. */
  sunDir: [number, number, number];
  hemi: [number, number, number];
  exposure: number;
  /** Strength of the road's bend (0 = straight). */
  bend: number;
  /** Beyond this distance ahead, vegetation is not drawn (it is fully fogged anyway). */
  range: number;
}

export const RICH: Record<string, Theme> = {
  "SCN-009": {
    kind: "hill",
    skyTop: 0x3b78e8,
    skyHorizon: 0xb4d0ee,
    fogDensity: 0.0078,
    sun: 0xfff1d6,
    sunPower: 2.7,
    sunDir: [-0.55, 0.62, 0.3],
    hemi: [0xbcd6ff, 0x70724a, 1.35],
    exposure: 1.0,
    bend: 1,
    range: 210,
  },
  "SCN-010": {
    kind: "paddy",
    skyTop: 0x6a92cc,
    skyHorizon: 0xf6dcc0,
    fogDensity: 0.0115,
    sun: 0xffc98f,
    sunPower: 2.3,
    sunDir: [0.3, 0.3, -0.9],
    hemi: [0xdbe4f2, 0x6c7a4a, 1.3],
    exposure: 1.05,
    bend: 0.55,
    range: 170,
  },
};

// ---- small helpers ------------------------------------------------------------------------

const hash2 = (a: number, b: number) => {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const vnoise = (x: number, y: number) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi) * (1 - u) + hash2(xi + 1, yi) * u;
  const b = hash2(xi, yi + 1) * (1 - u) + hash2(xi + 1, yi + 1) * u;
  return a * (1 - v) + b * v;
};
const fbm = (x: number, y: number) =>
  vnoise(x, y) * 0.5 +
  vnoise(x * 2.1, y * 2.1) * 0.27 +
  vnoise(x * 4.3, y * 4.3) * 0.15 +
  vnoise(x * 8.7, y * 8.7) * 0.08;
const rnd = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ss = (a: number, b: number, v: number) => smooth((v - a) / (b - a));
const hashId = (id: string) => {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 97;
};

/** Textures and tree geometry are built once per page and reused across clips (they are the slow part). */
const cache = new Map<string, unknown>();
const once = <V>(key: string, make: () => V): V => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as V;
};
const T = {
  grass: (k: "dry" | "paddy") => once(`grass:${k}`, () => grassTexture(k)),
  rock: () => once("rock", rockTexture),
  stone: () => once("stone", stoneTexture),
  asphalt: () => once("asphalt", () => asphaltTexture(true)),
  cloud: () => once("cloud", cloudCard),
  tuft: (dry: boolean, s: number) => once(`tuft:${dry}:${s}`, () => tuftCard(dry, s)),
  bush: (f: boolean, s: number) => once(`bush:${f}:${s}`, () => bushCard(f, s)),
  frond: () => once("frond", () => frondTexture()),
  palm: () => once("palmtex", () => palmFrondTexture()),
  leaf: (t: "oak" | "birch" | "tropical") => once(`leaf:${t}`, () => leafClusterTexture(t)),
  pines: () => once("pines", () => [pineGeometry(1), pineGeometry(2), pineGeometry(3)]),
  palms: () => once("palms", () => [palmGeometry(4), palmGeometry(5)]),
  oaks: () => once("oaks", () => [leafTreeGeometry(6), leafTreeGeometry(7, true)]),
};

/** Builds everything slow ahead of the clip (called while the loading screen is up). */
export function prewarmRich(theme: Theme) {
  T.asphalt();
  T.rock();
  T.cloud();
  T.tuft(theme.kind === "hill", 1);
  T.tuft(false, 5);
  T.bush(true, 2);
  T.bush(false, 9);
  if (theme.kind === "hill") {
    T.grass("dry");
    T.stone();
    T.frond();
    T.pines();
  } else {
    T.grass("paddy");
    T.palm();
    T.leaf("tropical");
    T.palms();
    T.oaks();
  }
}

const Z0 = 40;
const Z1 = -580;
const CHUNK = 64;

interface Chunk {
  mesh: InstancedMesh;
  hi: number;
  lo: number;
}
interface Item {
  m: Matrix4;
  c: Color | null;
  z: number;
}

export class RichWorld {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly sunLight: DirectionalLight;
  private readonly sunDir: Vector3;
  private readonly sky: Mesh;
  private readonly actors = new Map<string, Group>();
  private readonly chunks: Chunk[] = [];
  private readonly h: number;
  private readonly amp: number;
  private readonly adapt: Adaptive;
  private readonly own: { dispose(): void }[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly plan: ScenePlan,
    private readonly opts: { reducedMotion: boolean; lite: boolean },
    private readonly theme: Theme,
  ) {
    this.h = plan.geometry.h;
    this.amp = 15 * theme.bend;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.adapt = new Adaptive(
      this.renderer,
      0.5,
      Math.min(window.devicePixelRatio || 1, 1.5),
      opts.lite ? 0.75 : 1,
    );
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = theme.exposure;
    this.renderer.shadowMap.enabled = !opts.lite;

    const fog = new Color(theme.skyHorizon);
    this.scene.background = fog;
    this.scene.fog = new FogExp2(fog, theme.fogDensity);
    this.camera = new PerspectiveCamera(58, 16 / 9, 0.1, 700);
    this.scene.add(this.camera);

    // Image-based light gives vehicle paint and animal hide their soft sky reflections.
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    pmrem.dispose();

    this.scene.add(new HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemi[2]));
    this.sunDir = new Vector3(...theme.sunDir).normalize();
    this.sunLight = new DirectionalLight(theme.sun, theme.sunPower);
    if (this.renderer.shadowMap.enabled) {
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(1024, 1024);
      const c = this.sunLight.shadow.camera;
      c.left = -26;
      c.right = 26;
      c.top = 26;
      c.bottom = -26;
      c.near = 1;
      c.far = 140;
      this.sunLight.shadow.bias = -0.0005;
      this.sunLight.shadow.normalBias = 0.04;
    }
    this.scene.add(this.sunLight, this.sunLight.target);

    this.sky = this.makeSky();
    this.scene.add(this.sky);
    this.makeClouds();
    this.makeTerrain();
    this.makeRoad();
    this.makeRidges();
    this.dress();
    this.cockpit();
    this.update(0);
  }

  // ---- shape of the land ------------------------------------------------------------------

  /** Lateral shift of the road centre at z, so the road bends; zero at the start. */
  private bend(z: number) {
    const f = (zz: number) => this.amp * (Math.sin(zz / 110 + 0.3) + 0.42 * Math.sin(zz / 47 + 1));
    return f(z) - f(0);
  }
  private slope(z: number) {
    return this.amp * (Math.cos(z / 110 + 0.3) / 110 + (0.42 * Math.cos(z / 47 + 1)) / 47);
  }

  /** Ground height at logical (u across the road, z along it). */
  private ground(u: number, z: number): number {
    const h = this.h;
    const au = Math.abs(u);
    const w = ss(h + 0.3, h + 2.6, au);
    const n = fbm(u * 0.02 + 3, z * 0.02);
    if (this.theme.kind === "hill") {
      let y: number;
      if (u < 0) {
        const d = -u - (h + 0.7);
        y =
          d > 0
            ? d * 0.62 +
              (n - 0.4) * Math.min(d, 18) * 0.9 +
              vnoise(u * 0.25, z * 0.25) * Math.min(1.6, d * 0.2)
            : 0;
      } else {
        const d = u - (h + 1.8);
        y =
          d > 0
            ? -Math.min(d, 26) * 0.3 +
              Math.max(0, d - 40) * 0.36 +
              (n - 0.4) * Math.min(d, 30) * 0.5
            : 0;
      }
      return Math.max(-12, Math.min(48, y)) * w;
    }
    const field = -0.32 + (vnoise(u * 0.15, z * 0.15) - 0.5) * 0.08;
    const canal = -1.1 * Math.exp(-(((u - (h + 6.5)) / 2.3) ** 2));
    const far = Math.max(0, au - 105) * (0.18 + n * 0.5);
    const bund = z % 13 > 12.3 ? 0.07 : 0;
    return (field + canal + bund + far) * w;
  }

  // ---- sky, land, road --------------------------------------------------------------------

  private makeSky() {
    const mat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new Color(this.theme.skyTop) },
        hor: { value: new Color(this.theme.skyHorizon) },
        sun: { value: this.sunDir },
        sunCol: { value: new Color(this.theme.sun) },
      },
      vertexShader:
        "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 hor; uniform vec3 sun; uniform vec3 sunCol;
        void main(){ vec3 d = normalize(vP); float h = max(d.y, 0.0);
          vec3 c = mix(hor, top, pow(h, 0.55));
          float s = max(dot(d, normalize(sun)), 0.0);
          c += sunCol * (pow(s, 900.0) * 3.0 + pow(s, 40.0) * 0.22 + pow(s, 5.0) * 0.12);
          c = mix(c, hor, smoothstep(0.0, -0.12, d.y)); gl_FragColor = vec4(c, 1.0); }`,
    });
    this.own.push(mat);
    return new Mesh(new SphereGeometry(600, 24, 12), mat);
  }

  private makeClouds() {
    const m = new MeshBasicMaterial({
      map: T.cloud(),
      transparent: true,
      depthWrite: false,
      fog: false,
      opacity: 0.85,
    });
    const R = rnd(77);
    for (let i = 0; i < 6; i++) {
      const c = new Mesh(new PlaneGeometry(1, 0.5), m);
      const a = (R() * 0.9 - 0.45) * Math.PI;
      const r = 320 + R() * 160;
      c.position.set(Math.sin(a) * r, 130 + R() * 90, -Math.cos(a) * r);
      c.scale.setScalar(240 + R() * 220);
      c.lookAt(0, 0, 0);
      this.scene.add(c);
    }
    this.own.push(m);
  }

  private makeTerrain() {
    const kind = this.theme.kind;
    const NX = 90;
    const NZ = 220;
    const n = (NX + 1) * (NZ + 1);
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const rock = new Float32Array(n);
    const col = new Float32Array(n * 3);
    let k = 0;
    for (let j = 0; j <= NZ; j++) {
      const z = lerp(Z0, Z1, j / NZ);
      for (let i = 0; i <= NX; i++) {
        const s = (i / NX) * 2 - 1;
        const u = Math.sign(s) * s * s * 130;
        pos.set([u + this.bend(z), this.ground(u, z), z], k * 3);
        uv.set([u / 5, z / 5], k * 2);
        const dy = (this.ground(u + 0.8, z) - this.ground(u - 0.8, z)) / 1.6;
        rock[k] =
          kind === "hill" && u < 0
            ? ss(0.5, 0.95, Math.abs(dy) + (fbm(u * 0.3, z * 0.3) - 0.5) * 0.4)
            : 0;
        const q = fbm(u * 0.05 + 9, z * 0.05);
        col.set(
          kind === "hill"
            ? [0.8 + q * 0.45, 0.84 + q * 0.38, 0.66 + q * 0.3]
            : [0.8 + q * 0.3, 0.88 + q * 0.25, 0.64 + q * 0.2],
          k * 3,
        );
        k++;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX; i++) {
        const a = j * (NX + 1) + i;
        idx.push(a, a + 1, a + NX + 1, a + 1, a + NX + 2, a + NX + 1);
      }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("uv", new BufferAttribute(uv, 2));
    g.setAttribute("rockMix", new BufferAttribute(rock, 1));
    g.setAttribute("color", new BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const rockT = T.rock();
    const mat = new MeshLambertMaterial({
      map: T.grass(kind === "hill" ? "dry" : "paddy"),
      vertexColors: true,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms["rockMap"] = { value: rockT };
      sh.vertexShader = sh.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float rockMix;\nvarying float vRock;",
        )
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRock = rockMix;");
      // Two scales of the same turf (macro tint and fine blades) plus rock on steep faces.
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform sampler2D rockMap;\nvarying float vRock;",
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          vec3 fine = texture2D(map, vMapUv * 4.7).rgb * 1.3;
          vec3 stone = texture2D(rockMap, vMapUv * 0.42).rgb * 1.1;
          diffuseColor.rgb = mix(diffuseColor.rgb * fine, stone, vRock);`,
        );
    };
    this.own.push(mat, g);
    const m = new Mesh(g, mat);
    m.receiveShadow = true;
    this.scene.add(m);
    if (kind === "paddy") {
      const water = new MeshStandardMaterial({ color: 0x6f8fa0, roughness: 0.06, metalness: 0.85 });
      const geo = new PlaneGeometry(4.2, 15.5);
      this.own.push(water, geo);
      for (let z = Z0; z > Z1; z -= 14) {
        const p = new Mesh(geo, water);
        p.rotation.x = -Math.PI / 2;
        p.rotation.z = Math.atan(this.slope(z - 7));
        p.position.set(this.h + 6.5 + this.bend(z - 7), -0.62, z - 7);
        this.scene.add(p);
      }
    }
  }

  private makeRoad() {
    const h = this.h;
    const N = 130;
    const build = (half: number, y: number, mat: Material, vRep: number) => {
      const pos = new Float32Array((N + 1) * 6);
      const uv = new Float32Array((N + 1) * 4);
      const idx: number[] = [];
      for (let j = 0; j <= N; j++) {
        const z = lerp(Z0, Z1, j / N);
        const b = this.bend(z);
        pos.set([-half + b, y, z, half + b, y, z], j * 6);
        uv.set([0, z / vRep, 1, z / vRep], j * 4);
        if (j < N) idx.push(j * 2, j * 2 + 1, j * 2 + 2, j * 2 + 1, j * 2 + 3, j * 2 + 2);
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(pos, 3));
      g.setAttribute("uv", new BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new Mesh(g, mat);
      m.receiveShadow = true;
      this.scene.add(m);
      this.own.push(g, mat);
    };
    build(
      h + 1.0,
      0.012,
      new MeshLambertMaterial({ color: this.theme.kind === "hill" ? 0x7a7059 : 0x8b7d62 }),
      6,
    );
    build(
      h,
      0.03,
      new MeshLambertMaterial({
        map: T.asphalt(),
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      12,
    );
  }

  private makeRidges() {
    const hill = this.theme.kind === "hill";
    const tint = new Color(this.theme.skyHorizon).lerp(
      new Color(hill ? 0x5f80ab : 0xa9b9b0),
      hill ? 0.38 : 0.16,
    );
    for (const side of [-1, 1]) {
      const g = new PlaneGeometry(900, 90, 40, 1);
      const p = g.getAttribute("position");
      for (let i = 0; i < p.count; i++)
        if (p.getY(i) > 0) p.setY(i, 14 + fbm(p.getX(i) * 0.012 + side * 9, 3) * (hill ? 80 : 16));
      const m = new MeshBasicMaterial({ color: tint, fog: false });
      const r = new Mesh(g, m);
      r.rotation.y = side * Math.PI * 0.5;
      r.position.set(side * 330, -8, -250);
      this.scene.add(r);
      this.own.push(g, m);
    }
  }

  // ---- vegetation and props ---------------------------------------------------------------

  private cardGeo(aspect: number) {
    const a = new PlaneGeometry(aspect, 1);
    a.translate(0, 0.5, 0);
    const b = a.clone();
    b.rotateY(Math.PI / 2);
    const g = mergeGeometries([a, b]);
    this.own.push(g);
    return g;
  }

  /** Splits instances into 64 m chunks along the road so each can be culled on its own. */
  private emit(geo: BufferGeometry, mat: Material, items: Item[]) {
    const byChunk = new Map<number, Item[]>();
    for (const it of items) {
      const c = Math.floor((Z0 - it.z) / CHUNK);
      const list = byChunk.get(c);
      if (list) list.push(it);
      else byChunk.set(c, [it]);
    }
    for (const [c, list] of byChunk) {
      const mesh = new InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        mesh.setMatrixAt(i, it.m);
        if (it.c) mesh.setColorAt(i, it.c);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      this.chunks.push({ mesh, hi: Z0 - c * CHUNK + 20, lo: Z0 - (c + 1) * CHUNK - 20 });
    }
    this.own.push(mat);
  }

  private scatter(
    geo: BufferGeometry,
    mat: Material,
    count: number,
    place: (r: () => number) => { u: number; z: number },
    size: [number, number],
    tint: (r: () => number) => Color,
    seed: number,
    sink = 0.05,
  ) {
    const R = rnd(seed);
    const e = new Object3D();
    const items: Item[] = [];
    for (let i = 0; i < count; i++) {
      const p = place(R);
      const s = lerp(size[0], size[1], R());
      e.position.set(p.u + this.bend(p.z), this.ground(p.u, p.z) - sink, p.z);
      e.rotation.set(0, R() * Math.PI * 2, (R() - 0.5) * 0.06);
      e.scale.set(s, s, s);
      e.updateMatrix();
      items.push({ m: e.matrix.clone(), c: tint(R), z: p.z });
    }
    this.emit(geo, mat, items);
  }

  private dress() {
    const h = this.h;
    const hill = this.theme.kind === "hill";
    const side = (r: () => number) => (r() < 0.5 ? -1 : 1);
    const zAt = (r: () => number) => lerp(Z0, Z1, r());
    const card = (t: Texture) =>
      new MeshLambertMaterial({ map: t, alphaTest: 0.5, side: DoubleSide });
    const tree = (t: Texture) =>
      new MeshLambertMaterial({ map: t, alphaTest: 0.5, side: DoubleSide, vertexColors: true });
    const varied =
      (lo: number, hi: number, warm = 0) =>
      (r: () => number) => {
        const v = lerp(lo, hi, r());
        return new Color(v + warm * r(), v, v - warm * 0.4 * r());
      };

    // Ground cover: dense low tufts right at the verge, thinner further out.
    this.scatter(
      this.cardGeo(1.1),
      card(T.tuft(hill, 1)),
      2400,
      (r) => ({ u: side(r) * (h + 0.45 + r() ** 2.2 * 14), z: zAt(r) }),
      [0.3, 0.75],
      varied(0.8, 1.1, 0.05),
      101,
    );
    this.scatter(
      this.cardGeo(1.2),
      card(T.tuft(false, 5)),
      1300,
      (r) => ({ u: side(r) * (h + 0.4 + r() * 6), z: zAt(r) }),
      [0.25, 0.6],
      varied(0.7, 1.05),
      102,
    );
    // Shrubs and wildflowers.
    this.scatter(
      this.cardGeo(1.2),
      card(T.bush(true, 2)),
      230,
      (r) => ({ u: side(r) * (h + 0.9 + r() * 8), z: zAt(r) }),
      [1.0, 2.1],
      varied(0.8, 1.15),
      103,
    );
    this.scatter(
      this.cardGeo(1.3),
      card(T.bush(false, 9)),
      240,
      (r) => ({ u: side(r) * (h + 1.2 + r() * 20), z: zAt(r) }),
      [1.3, 2.6],
      varied(0.72, 1.05),
      104,
    );

    if (hill) {
      const pm = tree(T.frond());
      T.pines().forEach((g, i) => {
        this.scatter(
          g,
          pm,
          62,
          (r) => ({ u: -(h + 3 + r() ** 1.6 * 62), z: zAt(r) }),
          [9, 18],
          varied(0.62, 1.0),
          110 + i,
        );
        this.scatter(
          g,
          pm,
          24,
          (r) => ({ u: h + 5 + r() * 55, z: zAt(r) }),
          [8, 16],
          varied(0.62, 1.0),
          120 + i,
          0.1,
        );
      });
      // Boulders on the slope.
      const rg = new IcosahedronGeometry(1, 1);
      const rp = rg.getAttribute("position");
      for (let i = 0; i < rp.count; i++) {
        const f =
          0.78 +
          hash2(Math.round(rp.getX(i) * 40), Math.round(rp.getY(i) * 40 + rp.getZ(i) * 13)) * 0.45;
        rp.setXYZ(i, rp.getX(i) * f * 1.3, rp.getY(i) * f * 0.8, rp.getZ(i) * f);
      }
      rg.computeVertexNormals();
      this.own.push(rg);
      this.scatter(
        rg,
        new MeshLambertMaterial({ map: T.rock() }),
        70,
        (r) => ({ u: -(h + 1.5 + r() * 14), z: zAt(r) }),
        [0.5, 1.8],
        varied(0.7, 1.0),
        112,
      );
      this.stoneWall();
      this.guardRail();
    } else {
      const palm = tree(T.palm());
      T.palms().forEach((g, i) => {
        this.scatter(
          g,
          palm,
          70,
          (r) => ({ u: side(r) * (h + 2.5 + r() ** 1.4 * 36), z: zAt(r) }),
          [11, 18],
          varied(0.75, 1.05),
          130 + i,
        );
      });
      const leaf = tree(T.leaf("tropical"));
      T.oaks().forEach((g, i) => {
        this.scatter(
          g,
          leaf,
          55,
          (r) => ({ u: -(h + 4 + r() ** 1.3 * 38), z: zAt(r) }),
          [8, 15],
          varied(0.7, 1.05),
          140 + i,
        );
        this.scatter(
          g,
          leaf,
          20,
          (r) => ({ u: h + 12 + r() * 28, z: zAt(r) }),
          [8, 14],
          varied(0.7, 1.05),
          150 + i,
        );
      });
      // Reeds along the canal.
      this.scatter(
        this.cardGeo(0.7),
        card(T.tuft(false, 12)),
        380,
        (r) => ({ u: h + 3.4 + r() * 6.4, z: zAt(r) }),
        [0.8, 1.7],
        varied(0.7, 1.05),
        122,
      );
    }
  }

  private stoneWall() {
    const t = T.stone();
    t.repeat.set(1.6, 0.6);
    const g = new BoxGeometry(3.1, 0.95, 0.6);
    this.own.push(g);
    const R = rnd(55);
    const e = new Object3D();
    const items: Item[] = [];
    for (let i = 0; i < 205; i++) {
      const z = Z0 - i * 3.0;
      const u = -(this.h + 1.3 + Math.sin(z / 19) * 0.25);
      e.position.set(u + this.bend(z), this.ground(u, z) + 0.12, z);
      e.rotation.set(0, -Math.atan(this.slope(z)) + (R() - 0.5) * 0.04, 0);
      e.scale.set(1, 0.9 + R() * 0.3, 1);
      e.updateMatrix();
      items.push({ m: e.matrix.clone(), c: null, z });
    }
    this.emit(g, new MeshLambertMaterial({ map: t }), items);
  }

  private guardRail() {
    const rail = new BoxGeometry(4, 0.28, 0.08);
    const post = new CylinderGeometry(0.06, 0.06, 1.0, 6);
    this.own.push(rail, post);
    const mat = new MeshLambertMaterial({ color: 0xb8bcc0 });
    const e = new Object3D();
    const rails: Item[] = [];
    const posts: Item[] = [];
    for (let i = 0; i < 155; i++) {
      const z = Z0 - i * 4;
      const u = this.h + 1.1;
      const y = this.ground(u, z);
      e.position.set(u + this.bend(z - 2), y + 0.72, z - 2);
      e.rotation.set(0, -Math.atan(this.slope(z - 2)) + Math.PI / 2, 0);
      e.scale.set(1, 1, 1);
      e.updateMatrix();
      rails.push({ m: e.matrix.clone(), c: null, z });
      e.position.set(u + this.bend(z), y + 0.5, z);
      e.rotation.set(0, 0, 0);
      e.updateMatrix();
      posts.push({ m: e.matrix.clone(), c: null, z });
    }
    this.emit(rail, mat, rails);
    this.emit(post, mat, posts);
  }

  private cockpit() {
    const grp = new Group();
    this.camera.add(grp);
    if (this.plan.row.pov === "2W") {
      const dark = new MeshLambertMaterial({ color: 0x15161a });
      const bar = new Mesh(new CylinderGeometry(0.014, 0.014, 0.9, 10), dark);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, -0.36, -0.62);
      grp.add(bar);
      for (const sx of [-1, 1]) {
        const grip = new Mesh(
          new CylinderGeometry(0.02, 0.02, 0.13, 10),
          new MeshLambertMaterial({ color: 0x0e0e10 }),
        );
        grip.rotation.z = Math.PI / 2;
        grip.position.set(sx * 0.42, -0.36, -0.62);
        grp.add(grip);
      }
      const cluster = new Mesh(new SphereGeometry(0.07, 14, 10), dark);
      cluster.scale.set(1.4, 0.7, 0.8);
      cluster.position.set(0, -0.31, -0.58);
      grp.add(cluster);
    } else {
      box(grp, 2.4, 0.3, 0.9, 0x1d1f22, 0, -0.7, -0.8);
      box(grp, 0.5, 0.05, 0.4, 0x2b2e33, 0, -0.42, -0.62);
    }
    grp.traverse((o) => {
      if (o instanceof Mesh) o.renderOrder = 10;
    });
  }

  // ---- per frame --------------------------------------------------------------------------

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
    const eye = p.row.pov === "2W" ? 1.3 : 1.15;
    const bump =
      sway * (Math.sin(sec * 9) * 0.004 + Math.sin(sec * 3.1) * 0.003) * Math.min(1, speed / 6);
    this.camera.position.set(x + this.bend(z) + sway * Math.sin(sec * 0.7) * 0.03, eye + bump, z);
    this.camera.rotation.set(
      -0.03,
      Math.atan(this.slope(z)) + sway * Math.sin(sec * 0.5) * 0.004,
      sway * Math.sin(sec * 0.7) * 0.004 * Math.min(1, speed / 6),
      "YXZ",
    );
    this.sky.position.copy(this.camera.position);
    this.sunLight.position.copy(this.camera.position).addScaledVector(this.sunDir, 90);
    this.sunLight.target.position.set(this.camera.position.x, 0, this.camera.position.z - 14);

    // Only chunks near the camera are drawn.
    const ahead = z - this.theme.range;
    for (const c of this.chunks) c.mesh.visible = c.hi > ahead && c.lo < z + 26;

    for (const pose of p.poses(tMs)) {
      let a = this.actors.get(pose.id);
      if (!a) {
        a = makeRichModel(pose.kind, hashId(pose.id), p.row.setting);
        a.traverse((o) => {
          if (o instanceof Mesh && !(o.material as Material).transparent) o.castShadow = true;
        });
        this.scene.add(a);
        this.actors.set(pose.id, a);
      }
      const dz = pose.z - z;
      a.visible = dz < 12 && dz > -this.theme.range - 40;
      if (!a.visible) continue;
      a.position.set(pose.x + this.bend(pose.z), 0.03, pose.z);
      a.rotation.y = pose.yaw + Math.atan(this.slope(pose.z));
      animate(a, pose, tMs, this.opts.reducedMotion && pose.v < 0.01);
    }
    this.renderer.render(this.scene, this.camera);
    this.adapt.tick();
  }

  dispose() {
    for (const c of this.chunks) c.mesh.dispose();
    for (const d of this.own) d.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
