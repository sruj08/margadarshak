import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import type { ActorKind, Pose } from "./choreo";

/**
 * Procedural low-poly road users (no downloaded assets, so nothing to license or fetch). Every
 * model faces -z, is about real size in metres, and has no text, plates or brand marks (the
 * guardrails of NAZAR §16 carry over). `animate` poses limbs and wheels from the Pose alone.
 */
const mats = new Map<number, MeshStandardMaterial>();
const mat = (c: number, rough = 0.85) => {
  const key = c * 4 + (rough < 0.5 ? 1 : 0);
  let m = mats.get(key);
  if (!m) {
    m = new MeshStandardMaterial({
      color: c,
      roughness: rough,
      metalness: 0.05,
      flatShading: true,
    });
    mats.set(key, m);
  }
  return m;
};
const glow = (c: number) => new MeshBasicMaterial({ color: c });

const boxG = new BoxGeometry(1, 1, 1);
const cylG = new CylinderGeometry(0.5, 0.5, 1, 10);
const sphG = new SphereGeometry(0.5, 10, 8);
const coneG = new ConeGeometry(0.5, 1, 8);

export function box(g: Group, w: number, h: number, d: number, c: number, x = 0, y = 0, z = 0) {
  const m = new Mesh(boxG, mat(c));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}
export function ball(g: Group, r: number, c: number, x = 0, y = 0, z = 0) {
  const m = new Mesh(sphG, mat(c));
  m.scale.setScalar(r * 2);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}
export function cone(g: Group, r: number, h: number, c: number, x = 0, y = 0, z = 0) {
  const m = new Mesh(coneG, mat(c));
  m.scale.set(r * 2, h, r * 2);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}
/** A wheel (axle along x) that spins in `animate`. */
function wheel(g: Group, r: number, w: number, x: number, y: number, z: number) {
  const m = new Mesh(cylG, mat(0x1b1b1d, 0.9));
  m.scale.set(r * 2, w, r * 2);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  m.name = "wheel";
  g.add(m);
}
function shadow(g: Group, w: number, l: number) {
  const m = new Mesh(
    new CircleGeometry(0.5, 14),
    new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.scale.set(w, l, 1);
  m.position.y = 0.02;
  g.add(m);
}
function lamp(g: Group, c: number, x: number, y: number, z: number, s = 0.12) {
  const m = new Mesh(sphG, glow(c));
  m.scale.setScalar(s);
  m.position.set(x, y, z);
  g.add(m);
}

const SKIN = [0xc68a5c, 0xa8693f, 0xd9a07a, 0x8d5a3a];
const SHIRT = [0x3d6fb6, 0xb8452f, 0x4f8a5b, 0xd6a93a, 0x7b5aa6, 0x8a8f96];

function person(g: Group, i: number, scale = 1, uniform?: number, helmet?: number) {
  const body = new Group();
  body.name = "body";
  const shirt = uniform ?? (SHIRT[i % SHIRT.length] as number);
  const legL = new Group();
  const legR = new Group();
  legL.position.set(-0.1, 0.85, 0);
  legR.position.set(0.1, 0.85, 0);
  box(legL, 0.16, 0.85, 0.18, 0x2c3340, 0, -0.42, 0);
  box(legR, 0.16, 0.85, 0.18, 0x2c3340, 0, -0.42, 0);
  legL.name = "legL";
  legR.name = "legR";
  body.add(legL, legR);
  box(body, 0.42, 0.6, 0.24, shirt, 0, 1.15, 0);
  ball(body, 0.12, SKIN[i % SKIN.length] as number, 0, 1.6, 0);
  if (helmet !== undefined) ball(body, 0.17, helmet, 0, 1.63, 0.01);
  g.add(body);
  body.scale.setScalar(scale);
}

function scooter(g: Group, i: number, withRider = true) {
  wheel(g, 0.28, 0.1, 0, 0.28, -0.6);
  wheel(g, 0.28, 0.14, 0, 0.28, 0.6);
  box(g, 0.5, 0.5, 1.1, [0x2f6fa8, 0xc8372d, 0x3b3d42, 0xd9d4c5][i % 4] as number, 0, 0.55, 0.1);
  box(g, 0.34, 0.5, 0.1, [0x2f6fa8, 0xc8372d, 0x3b3d42, 0xd9d4c5][i % 4] as number, 0, 0.75, -0.55);
  box(g, 0.6, 0.05, 0.05, 0x222222, 0, 1.05, -0.5);
  lamp(g, 0xfff3c4, 0, 0.9, -0.62, 0.14);
  lamp(g, 0xd23b2f, 0, 0.7, 0.68, 0.1);
  if (withRider) {
    const r = new Group();
    r.position.set(0, 0.12, 0.2);
    person(r, i, 0.95, undefined, [0xd9c24a, 0x2d3a8c, 0xb13a3a][i % 3] as number);
    g.add(r);
  }
  shadow(g, 0.8, 1.8);
}

function car(g: Group, body: number, taxi = false) {
  box(g, 1.75, 0.65, 4.0, body, 0, 0.65, 0);
  box(g, 1.55, 0.55, 2.0, taxi ? 0xe9d54a : 0xaab8c4, 0, 1.2, 0.2);
  for (const sx of [-0.85, 0.85]) {
    wheel(g, 0.32, 0.22, sx, 0.32, -1.3);
    wheel(g, 0.32, 0.22, sx, 0.32, 1.3);
    lamp(g, 0xfff3c4, sx * 0.8, 0.7, -2.02);
    lamp(g, 0xd23b2f, sx * 0.8, 0.75, 2.02, 0.1);
  }
  // Driver-side door (right-hand drive), hinged at its front edge; opens in animate via `door`.
  const door = new Group();
  door.name = "door";
  door.position.set(0.88, 0.95, -0.55);
  box(door, 0.06, 0.7, 1.0, body, 0, 0, 0.5);
  g.add(door);
  shadow(g, 2.0, 4.4);
}

function auto(g: Group) {
  const green = 0x2e7d4a;
  box(g, 1.3, 0.7, 2.2, 0xe5b82b, 0, 0.7, 0.2);
  box(g, 1.3, 0.12, 1.4, 0x1c1d20, 0, 1.55, 0.4);
  box(g, 0.08, 0.85, 0.08, green, -0.6, 1.1, -0.35);
  box(g, 0.08, 0.85, 0.08, green, 0.6, 1.1, -0.35);
  box(g, 1.2, 0.4, 0.5, green, 0, 0.45, -1.0);
  wheel(g, 0.25, 0.14, 0, 0.25, -1.2);
  wheel(g, 0.25, 0.14, -0.6, 0.25, 0.8);
  wheel(g, 0.25, 0.14, 0.6, 0.25, 0.8);
  lamp(g, 0xfff3c4, 0, 0.8, -1.25, 0.16);
  shadow(g, 1.6, 2.8);
}

function bus(g: Group, body: number) {
  box(g, 2.5, 2.3, 10, body, 0, 1.6, 0);
  box(g, 2.52, 0.8, 9.2, 0x23303a, 0, 2.15, 0);
  box(g, 2.5, 0.4, 10, 0x6b6e73, 0, 0.55, 0);
  for (const sx of [-1.2, 1.2]) {
    wheel(g, 0.5, 0.3, sx, 0.5, -3.2);
    wheel(g, 0.5, 0.3, sx, 0.5, 3);
  }
  lamp(g, 0xfff3c4, -0.8, 0.9, -5.02, 0.2);
  lamp(g, 0xfff3c4, 0.8, 0.9, -5.02, 0.2);
  shadow(g, 3, 11);
}

function truck(g: Group, body: number) {
  box(g, 2.3, 2.0, 2.2, body, 0, 1.4, -3.4);
  box(g, 2.2, 0.8, 0.1, 0x23303a, 0, 1.9, -4.5);
  box(g, 2.5, 2.6, 6.2, 0xb9b5a8, 0, 1.9, 1.2);
  box(g, 2.2, 0.3, 11, 0x333537, 0, 0.55, -0.2);
  for (const sx of [-1.1, 1.1]) for (const z of [-3.4, 2.2, 3.7]) wheel(g, 0.5, 0.3, sx, 0.5, z);
  const ind = new Mesh(sphG, glow(0xffa51f));
  ind.name = "indicator";
  ind.scale.setScalar(0.2);
  ind.position.set(-1.15, 1.0, -4.55);
  g.add(ind);
  lamp(g, 0xfff3c4, 0.8, 1.0, -4.55, 0.2);
  shadow(g, 3, 11);
}

function van(g: Group, body: number) {
  box(g, 1.9, 1.7, 4.4, body, 0, 1.15, 0);
  box(g, 1.7, 0.6, 0.1, 0x23303a, 0, 1.55, -2.2);
  for (const sx of [-0.9, 0.9]) {
    wheel(g, 0.33, 0.22, sx, 0.33, -1.4);
    wheel(g, 0.33, 0.22, sx, 0.33, 1.4);
  }
  lamp(g, 0xfff3c4, -0.6, 0.8, -2.22);
  lamp(g, 0xfff3c4, 0.6, 0.8, -2.22);
  shadow(g, 2.1, 4.8);
}

function cow(g: Group, white: boolean) {
  const c = white ? 0xe6e1d3 : 0x7a5a3d;
  const body = new Group();
  body.name = "body";
  box(body, 0.6, 0.75, 1.5, c, 0, 1.0, 0);
  box(body, 0.34, 0.4, 0.5, c, 0, 1.2, -0.95);
  box(body, 0.05, 0.05, 0.3, 0xd8d2c0, -0.18, 1.45, -1.05);
  box(body, 0.05, 0.05, 0.3, 0xd8d2c0, 0.18, 1.45, -1.05);
  for (const sx of [-0.2, 0.2])
    for (const z of [-0.55, 0.55]) {
      const leg = new Group();
      leg.position.set(sx, 0.7, z);
      box(leg, 0.12, 0.7, 0.12, c, 0, -0.35, 0);
      leg.name = z < 0 ? "legL" : "legR";
      body.add(leg);
    }
  g.add(body);
  shadow(g, 0.9, 1.9);
}

function dog(g: Group) {
  const body = new Group();
  body.name = "body";
  box(body, 0.22, 0.28, 0.6, 0xb08a58, 0, 0.45, 0);
  box(body, 0.18, 0.2, 0.22, 0xb08a58, 0, 0.58, -0.38);
  for (const sx of [-0.07, 0.07])
    for (const z of [-0.2, 0.2]) {
      const leg = new Group();
      leg.position.set(sx, 0.32, z);
      box(leg, 0.06, 0.32, 0.06, 0x9a7646, 0, -0.16, 0);
      leg.name = z < 0 ? "legL" : "legR";
      body.add(leg);
    }
  g.add(body);
  shadow(g, 0.4, 0.8);
}

function cyclist(g: Group, i: number) {
  wheel(g, 0.34, 0.05, 0, 0.34, -0.55);
  wheel(g, 0.34, 0.05, 0, 0.34, 0.55);
  box(g, 0.05, 0.05, 1.1, 0x303236, 0, 0.7, 0);
  const r = new Group();
  r.position.y = -0.1;
  person(r, i, 0.95, 0x6b8f9a);
  g.add(r);
  shadow(g, 0.5, 1.5);
}

function cart(g: Group) {
  box(g, 1.1, 0.12, 1.8, 0x8a6a3b, 0, 0.9, 0);
  box(g, 1.1, 0.35, 0.08, 0x8a6a3b, 0, 1.1, -0.9);
  box(g, 1.1, 0.35, 0.08, 0x8a6a3b, 0, 1.1, 0.9);
  for (const [c, x, z] of [
    [0xc0392b, -0.3, -0.3],
    [0x3f9142, 0.2, 0.2],
    [0xe3a72f, 0.3, -0.4],
    [0x6a8e23, -0.2, 0.5],
  ] as const)
    ball(g, 0.22, c, x, 1.25, z);
  wheel(g, 0.42, 0.06, -0.6, 0.42, 0.2);
  wheel(g, 0.42, 0.06, 0.6, 0.42, 0.2);
  box(g, 0.05, 0.05, 1.0, 0x6b4f2a, 0, 0.95, -1.4);
  shadow(g, 1.4, 2.6);
}

function patch(g: Group, kind: "puddle" | "gravel") {
  const m = new Mesh(
    new CircleGeometry(0.5, 20),
    new MeshStandardMaterial({
      color: kind === "puddle" ? 0x4a5f6e : 0x3a3631,
      roughness: kind === "puddle" ? 0.12 : 1,
      metalness: kind === "puddle" ? 0.5 : 0,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.035;
  if (kind === "puddle") m.scale.set(2.6, 5, 1);
  else {
    m.scale.set(2.6, 7, 1);
    for (let i = 0; i < 26; i++)
      box(
        g,
        0.1 + (i % 3) * 0.05,
        0.06,
        0.12,
        i % 2 ? 0x8a8478 : 0x6e695f,
        ((i * 7) % 11) / 5 - 1,
        0.05,
        ((i * 13) % 17) / 2.4 - 3.4,
      );
  }
  g.add(m);
}

export function makeModel(kind: ActorKind, seed: number, setting: string): Group {
  const g = new Group();
  switch (kind) {
    case "ped":
      person(g, seed);
      break;
    case "child":
      person(g, seed, 0.72, 0xf2f2f2);
      box(g, 0.28, 0.32, 0.12, 0xd9534f, 0, 1.0, 0.16);
      break;
    case "cow":
      cow(g, seed % 2 === 0);
      break;
    case "dog":
      dog(g);
      break;
    case "scooter":
      scooter(g, seed);
      break;
    case "cyclist":
      cyclist(g, seed);
      break;
    case "car":
      car(
        g,
        [0xd6d9dd, 0x3a4f6b, 0x8c2f2f, 0x2f3338, 0xc9cdd1][seed % 5] as number,
        setting === "metro_residential" && seed === 99,
      );
      break;
    case "auto":
      auto(g);
      break;
    case "bus":
      bus(g, seed % 2 ? 0xf2efe6 : 0xe9dcc2);
      break;
    case "truck":
      truck(g, [0x3d6a8a, 0x9a4a2c, 0x5a7d4a][seed % 3] as number);
      break;
    case "van":
      van(g, seed % 2 ? 0xf4f4f1 : 0xe7c34a);
      break;
    case "cart":
      cart(g);
      break;
    case "ball":
      ball(g, 0.13, 0xe6e6e6, 0, 0.13, 0);
      break;
    case "puddle":
    case "gravel":
      patch(g, kind);
      break;
  }
  return g;
}

/** Poses limbs, wheels, the car door and the truck indicator from the pose and media time. */
export function animate(g: Group, p: Pose, tMs: number, still: boolean) {
  const sec = tMs / 1000;
  const walking =
    p.kind === "ped" ||
    p.kind === "child" ||
    p.kind === "cow" ||
    p.kind === "dog" ||
    p.kind === "goat";
  g.traverse((o) => {
    if (o.name === "wheel") o.rotation.x = still ? 0 : -(sec * p.v) / 0.3;
    else if (o.name === "legL" || o.name === "legR") {
      const amp = walking && !still ? Math.min(0.7, p.v / 1.6) : 0;
      const k = Math.sin(sec * (p.kind === "dog" ? 14 : p.kind === "cow" ? 5 : 7)) * amp;
      o.rotation.x = o.name === "legL" ? k : -k;
    } else if (o.name === "door") o.rotation.y = p.aux;
    else if (o.name === "indicator") (o as Mesh).visible = p.aux > 0 && Math.sin(sec * 8) > 0;
  });
}
