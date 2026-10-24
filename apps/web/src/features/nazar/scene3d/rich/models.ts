import {
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { ActorKind } from "../choreo";
import { makeModel as basicModel } from "../models";

/**
 * Detailed models for the showcase scenes: rounded, glossy vehicles and anatomically proportioned
 * animals. Same rules as the basic models: faces -z, real size in metres, no text or plates, and
 * the same child names (`wheel`, `legL`, `legR`, `door`) so `animate` poses them unchanged.
 */
const paint = new Map<number, MeshStandardMaterial>();
const std = (c: number, rough = 0.5, metal = 0.0) => {
  const key = c * 100 + Math.round(rough * 10) * 10 + Math.round(metal * 10);
  let m = paint.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
    paint.set(key, m);
  }
  return m;
};
const glass = new MeshStandardMaterial({ color: 0x14202b, roughness: 0.08, metalness: 0.7 });
const rb = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 4, r);
const sph = new SphereGeometry(0.5, 20, 14);
const cyl = new CylinderGeometry(0.5, 0.5, 1, 18);

function put(
  g: Group,
  geo: Mesh["geometry"],
  m: MeshStandardMaterial | MeshBasicMaterial,
  x: number,
  y: number,
  z: number,
) {
  const o = new Mesh(geo, m);
  o.position.set(x, y, z);
  g.add(o);
  return o;
}
function ell(
  g: Group,
  sx: number,
  sy: number,
  sz: number,
  m: MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
) {
  const o = put(g, sph, m, x, y, z);
  o.scale.set(sx, sy, sz);
  return o;
}
function tyre(g: Group, r: number, w: number, x: number, y: number, z: number) {
  const t = new Group();
  t.position.set(x, y, z);
  const a = new Mesh(cyl, std(0x16161a, 0.95));
  a.scale.set(r * 2, w, r * 2);
  const b = new Mesh(cyl, std(0xb9bcc2, 0.3, 0.8));
  b.scale.set(r * 1.2, w * 1.02, r * 1.2);
  t.add(a, b);
  t.rotation.z = Math.PI / 2;
  const wrap = new Group();
  wrap.name = "wheel";
  wrap.position.set(x, y, z);
  t.position.set(0, 0, 0);
  wrap.add(t);
  g.add(wrap);
}

function softShadow(g: Group, w: number, l: number) {
  const m = new Mesh(
    new SphereGeometry(0.5, 16, 4),
    new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  m.scale.set(w, 0.02, l);
  m.position.y = 0.03;
  g.add(m);
}

function car(g: Group, body: number) {
  const bm = std(body, 0.28, 0.45);
  put(g, rb(1.8, 0.62, 4.1, 0.22), bm, 0, 0.62, 0);
  const cab = put(g, rb(1.5, 0.52, 2.0, 0.2), glass, 0, 1.12, 0.25);
  cab.rotation.x = 0.02;
  put(g, rb(1.46, 0.07, 1.8, 0.03), bm, 0, 1.4, 0.25);
  put(g, rb(1.84, 0.22, 4.15, 0.08), std(0x1d1e22, 0.7), 0, 0.32, 0);
  for (const sx of [-0.88, 0.88]) {
    tyre(g, 0.33, 0.24, sx, 0.33, -1.32);
    tyre(g, 0.33, 0.24, sx, 0.33, 1.32);
    const head = put(g, sph, new MeshBasicMaterial({ color: 0xfff4d6 }), sx * 0.78, 0.74, -2.04);
    head.scale.set(0.26, 0.12, 0.08);
    const tail = put(g, sph, new MeshBasicMaterial({ color: 0xb3261e }), sx * 0.78, 0.78, 2.05);
    tail.scale.set(0.3, 0.1, 0.06);
    put(g, rb(0.14, 0.08, 0.2, 0.03), bm, sx * 1.02, 0.98, -0.5);
  }
  const door = new Group();
  door.name = "door";
  door.position.set(0.91, 0.95, -0.55);
  put(door, rb(0.05, 0.55, 1.0, 0.02), bm, 0, 0, 0.5);
  g.add(door);
  softShadow(g, 2.3, 4.7);
}

function van(g: Group, body: number) {
  const bm = std(body, 0.35, 0.3);
  put(g, rb(1.9, 1.7, 4.5, 0.2), bm, 0, 1.15, 0);
  put(g, rb(1.7, 0.6, 0.14, 0.05), glass, 0, 1.5, -2.22);
  for (const sx of [-0.92, 0.92]) {
    tyre(g, 0.34, 0.24, sx, 0.34, -1.4);
    tyre(g, 0.34, 0.24, sx, 0.34, 1.4);
  }
  const h = put(g, sph, new MeshBasicMaterial({ color: 0xfff4d6 }), 0, 0.8, -2.25);
  h.scale.set(1.4, 0.12, 0.08);
  softShadow(g, 2.3, 5);
}

function bus(g: Group, body: number) {
  const bm = std(body, 0.4, 0.2);
  put(g, rb(2.5, 2.4, 10, 0.25), bm, 0, 1.7, 0);
  put(g, rb(2.54, 0.8, 9.3, 0.1), glass, 0, 2.2, 0);
  put(g, rb(2.52, 0.5, 10.02, 0.1), std(0x5b5e63, 0.8), 0, 0.62, 0);
  for (const sx of [-1.2, 1.2]) {
    tyre(g, 0.52, 0.32, sx, 0.52, -3.2);
    tyre(g, 0.52, 0.32, sx, 0.52, 3);
  }
  for (const sx of [-0.8, 0.8])
    put(g, sph, new MeshBasicMaterial({ color: 0xfff4d6 }), sx, 0.95, -5.0).scale.set(
      0.3,
      0.2,
      0.1,
    );
  softShadow(g, 3, 11);
}

const HIDE = [0x8a6240, 0x9b7650, 0x6f4e33, 0xb08a60];

function legs(body: Group, pts: [number, number][], len: number, thick: number, c: number) {
  for (const [x, z] of pts) {
    const leg = new Group();
    leg.position.set(x, len + 0.05, z);
    leg.name = z < 0 ? "legL" : "legR";
    const seg = put(
      leg,
      new CapsuleGeometry(thick, len - thick * 2, 4, 8),
      std(c, 0.9),
      0,
      -len / 2,
      0,
    );
    seg.scale.set(1, 1, 1);
    put(leg, sph, std(0x1c1a18, 0.9), 0, -len, 0).scale.set(thick * 2.3, thick * 1.2, thick * 2.5);
    body.add(leg);
  }
}

function cow(g: Group, seed: number) {
  const c = HIDE[seed % HIDE.length] as number;
  const m = std(c, 0.92);
  const body = new Group();
  body.name = "body";
  ell(body, 0.7, 0.75, 1.55, m, 0, 1.12, 0.1);
  ell(body, 0.62, 0.62, 0.7, m, 0, 1.18, -0.55);
  ell(body, 0.4, 0.42, 0.66, m, 0, 1.26, -1.14).rotation.x = 0.35;
  ell(body, 0.26, 0.24, 0.3, std(0xe2c4b0, 0.9), 0, 1.08, -1.5);
  for (const sx of [-1, 1]) {
    ell(body, 0.2, 0.08, 0.16, m, sx * 0.3, 1.42, -1.0).rotation.z = sx * 0.4;
    put(
      body,
      new CapsuleGeometry(0.025, 0.14, 3, 6),
      std(0xe8e0cc, 0.6),
      sx * 0.2,
      1.55,
      -1.0,
    ).rotation.z = -sx * 0.5;
  }
  if (c === 0xe9e4d6 || c === 0xb99a72)
    for (let i = 0; i < 4; i++)
      ell(
        body,
        0.28 + (i % 2) * 0.1,
        0.22,
        0.36,
        std(0x3a2d24, 0.95),
        (i % 2 ? 0.3 : -0.32) * 1.0,
        1.4 - i * 0.07,
        -0.4 + i * 0.5,
      );
  put(body, new CapsuleGeometry(0.03, 0.9, 3, 6), m, 0, 1.05, 1.45).rotation.x = 0.25;
  ell(body, 0.2, 0.22, 0.26, std(0xd0a090, 0.9), 0, 0.75, 0.75);
  legs(
    body,
    [
      [-0.27, -0.55],
      [0.27, -0.55],
      [-0.27, 0.8],
      [0.27, 0.8],
    ],
    0.84,
    0.1,
    c,
  );
  g.add(body);
  softShadow(g, 1.1, 2.4);
}

function dog(g: Group, seed: number) {
  const c = [0xb08a58, 0x6b4a32, 0xd8c8a8][seed % 3] as number;
  const m = std(c, 0.95);
  const body = new Group();
  body.name = "body";
  ell(body, 0.26, 0.28, 0.66, m, 0, 0.5, 0.05);
  ell(body, 0.2, 0.22, 0.26, m, 0, 0.62, -0.42);
  ell(body, 0.11, 0.1, 0.18, m, 0, 0.58, -0.58);
  put(body, sph, std(0x111111, 0.4), 0, 0.6, -0.68).scale.set(0.05, 0.04, 0.04);
  for (const sx of [-1, 1])
    ell(body, 0.05, 0.14, 0.09, std(0x4a3524, 0.95), sx * 0.12, 0.7, -0.4).rotation.z = sx * 0.3;
  put(body, new CapsuleGeometry(0.025, 0.3, 3, 6), m, 0, 0.62, 0.45).rotation.x = -0.9;
  legs(
    body,
    [
      [-0.09, -0.2],
      [0.09, -0.2],
      [-0.09, 0.3],
      [0.09, 0.3],
    ],
    0.34,
    0.035,
    c,
  );
  g.add(body);
  softShadow(g, 0.5, 1.0);
}

function goat(g: Group, seed: number) {
  const c = [0xe3ddd0, 0x7a6a58][seed % 2] as number;
  const m = std(c, 0.95);
  const body = new Group();
  body.name = "body";
  ell(body, 0.34, 0.4, 0.8, m, 0, 0.7, 0.05);
  ell(body, 0.2, 0.2, 0.3, m, 0, 0.98, -0.5).rotation.x = 0.3;
  ell(body, 0.12, 0.12, 0.18, m, 0, 0.92, -0.68);
  for (const sx of [-1, 1]) {
    put(
      body,
      new CapsuleGeometry(0.015, 0.22, 3, 6),
      std(0x3a342c, 0.6),
      sx * 0.07,
      1.18,
      -0.5,
    ).rotation.set(-0.4, 0, -sx * 0.4);
    ell(body, 0.04, 0.12, 0.08, m, sx * 0.14, 1.0, -0.5).rotation.z = sx * 0.9;
  }
  put(body, new CapsuleGeometry(0.012, 0.1, 3, 6), m, 0, 0.8, -0.74);
  legs(
    body,
    [
      [-0.12, -0.3],
      [0.12, -0.3],
      [-0.12, 0.4],
      [0.12, 0.4],
    ],
    0.5,
    0.04,
    c,
  );
  g.add(body);
  softShadow(g, 0.7, 1.4);
}

/** The detailed model for a kind, or the basic one where there is no detailed one. */
export function makeRichModel(kind: ActorKind | "goat", seed: number, setting: string): Group {
  const g = new Group();
  switch (kind) {
    case "car":
      car(g, [0xdfe3e6, 0x26435f, 0x7a2a2a, 0x2c3035, 0xc7ccd1][seed % 5] as number);
      return g;
    case "van":
      van(g, seed % 2 ? 0xf4f4f1 : 0xdfc25a);
      return g;
    case "bus":
      bus(g, seed % 2 ? 0xf2efe6 : 0xe9dcc2);
      return g;
    case "cow":
      cow(g, seed);
      return g;
    case "dog":
      dog(g, seed);
      return g;
    case "goat":
      goat(g, seed);
      return g;
    default:
      return basicModel(kind, seed, setting);
  }
}
