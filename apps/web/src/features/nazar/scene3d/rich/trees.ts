import { BufferAttribute, BufferGeometry } from "three";

/**
 * Real 3D tree geometry for the showcase scenes, built from a trunk and a few hundred textured
 * quads (branches or leaf clusters). Vertex colours darken the inside of the crown, which stands
 * in for ambient occlusion and is most of what makes a tree read as solid. One merged geometry per
 * variant is instanced hundreds of times. Every tree is about one unit tall: scale it.
 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rect = readonly [number, number, number, number];
const FROND_UV: Rect = [0.08, 1, 0, 1];
const LEAF_UV: Rect = [0.07, 1, 0.07, 1];
const BARK_UV: Rect = [0.001, 0.02, 0.97, 0.99];

class Mesher {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  vert(x: number, y: number, z: number, u: number, v: number, shade: number) {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    this.col.push(shade, shade, shade);
    return this.pos.length / 3 - 1;
  }

  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }

  /** A tapered prism from y0 to y1; the bark patch gives it its colour. */
  trunk(r0: number, r1: number, y0: number, y1: number, shade: number, sides: number, lean = 0) {
    const ring = (y: number, r: number, off: number) => {
      const ids: number[] = [];
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        ids.push(this.vert(Math.cos(a) * r + off, y, Math.sin(a) * r, 0.01, 0.98, shade));
      }
      return ids;
    };
    const lo = ring(y0, r0, 0);
    const hi = ring(y1, r1, lean);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.quad(lo[i] as number, lo[j] as number, hi[j] as number, hi[i] as number);
    }
  }

  /** A drooping strip from (ox,oy,oz) along (dx,dz): `len` long, `wid` wide, tip hanging `droop` lower. */
  strip(
    o: readonly [number, number, number],
    dir: readonly [number, number],
    len: number,
    wid: number,
    droop: number,
    shade: readonly [number, number],
    uv: Rect,
    lift: number,
  ) {
    const [u0, u1, v0, v1] = uv;
    const px = -dir[1];
    const pz = dir[0];
    const rows: [number, number][] = [];
    for (let s = 0; s <= 3; s++) {
      const t = s / 3;
      const cx = o[0] + dir[0] * len * t;
      const cz = o[2] + dir[1] * len * t;
      const cy = o[1] + lift * t - droop * t * t;
      const w = wid * (0.45 + 0.55 * Math.sin(Math.min(1, t + 0.12) * Math.PI * 0.92));
      const sh = shade[0] + (shade[1] - shade[0]) * t;
      const u = u0 + (u1 - u0) * t;
      rows.push([
        this.vert(cx - px * w * 0.5, cy, cz - pz * w * 0.5, u, v0, sh),
        this.vert(cx + px * w * 0.5, cy, cz + pz * w * 0.5, u, v1, sh),
      ]);
    }
    for (let s = 0; s < 3; s++) {
      const a = rows[s] as [number, number];
      const b = rows[s + 1] as [number, number];
      this.quad(a[0], b[0], b[1], a[1]);
    }
  }

  /** A square leaf cluster centred on (x,y,z), turned `yaw` and pitched `tilt`. */
  cluster(x: number, y: number, z: number, size: number, yaw: number, tilt: number, shade: number) {
    const [u0, u1, v0, v1] = LEAF_UV;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const at = (cu: number, cv: number, u: number, v: number) => {
      const lx = cu * size;
      const ly = cv * size * 0.8;
      return this.vert(x + lx * cy, y + ly * ct, z + lx * sy + ly * st, u, v, shade);
    };
    this.quad(
      at(-0.5, -0.5, u0, v0),
      at(0.5, -0.5, u1, v0),
      at(0.5, 0.5, u1, v1),
      at(-0.5, 0.5, u0, v1),
    );
  }

  build() {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    // Foliage is lit from above whichever way a card faces, so the crown reads as one soft mass.
    const n = g.getAttribute("normal");
    for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.35, 0.94, n.getZ(i) * 0.35);
    return g;
  }
}

/** A conifer: trunk, then whorls of drooping needled branches that shorten towards the top. */
export function pineGeometry(seed: number) {
  const R = rng(seed);
  const m = new Mesher();
  m.trunk(0.016, 0.004, 0, 1, 1.0, 5);
  const whorls = 26;
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = 0.14 + t * 0.84;
    const reach = 0.3 * (1 - t) ** 0.82 + 0.025;
    const n = t < 0.6 ? 6 : 5;
    const phase = R() * 6.28;
    for (let b = 0; b < n; b++) {
      const a = phase + (b / n) * Math.PI * 2 + (R() - 0.5) * 0.4;
      m.strip(
        [0, y, 0],
        [Math.cos(a), Math.sin(a)],
        reach * (0.85 + R() * 0.3),
        reach * 0.55,
        reach * (0.3 + R() * 0.2),
        [0.4 + t * 0.2, 1],
        FROND_UV,
        0.01,
      );
    }
  }
  return m.build();
}

/** A broadleaf tree: trunk, a few limbs, and a crown of leaf-cluster cards shaded dark inside. */
export function leafTreeGeometry(seed: number, birch = false) {
  const R = rng(seed);
  const m = new Mesher();
  m.trunk(birch ? 0.022 : 0.034, 0.012, 0, 0.62, birch ? 1.6 : 0.85, 6, (R() - 0.5) * 0.05);
  const crown = birch ? 0.3 : 0.42;
  for (let l = 0; l < 4; l++) {
    const a = R() * 6.28;
    m.strip(
      [0, 0.4 + l * 0.05, 0],
      [Math.cos(a), Math.sin(a)],
      crown * 0.9,
      0.02,
      -0.04 + l * 0.04,
      [0.8, 0.8],
      BARK_UV,
      0.12,
    );
  }
  for (let i = 0; i < 100; i++) {
    const v = R() * 2 - 1;
    const r = crown * (0.35 + 0.65 * Math.cbrt(R())) * Math.sqrt(1 - v * v * 0.6);
    const th = R() * Math.PI * 2;
    const k = (v + 1) / 2;
    m.cluster(
      Math.cos(th) * r,
      0.66 + v * crown * 0.75 + (birch ? 0.1 : 0),
      Math.sin(th) * r,
      0.2 + R() * 0.12,
      R() * 6.28,
      (R() - 0.5) * 1.1,
      0.5 + 0.5 * k * (0.5 + 0.5 * (r / crown)),
    );
  }
  return m.build();
}

/** A coconut palm: ringed leaning trunk and a crown of arching fronds. */
export function palmGeometry(seed: number) {
  const R = rng(seed);
  const m = new Mesher();
  for (let s = 0; s < 6; s++)
    m.trunk(
      0.026 - (s / 6) * 0.012,
      0.026 - ((s + 1) / 6) * 0.012,
      (s / 6) * 0.9,
      ((s + 1) / 6) * 0.9,
      1.0,
      6,
      (R() - 0.5) * 0.01,
    );
  const fronds = 14;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + (R() - 0.5) * 0.3;
    const len = 0.36 + R() * 0.1;
    m.strip(
      [0, 0.9 + (f % 2 ? 0.05 : 0), 0],
      [Math.cos(a), Math.sin(a)],
      len,
      len * 0.5,
      len * (0.55 + R() * 0.25),
      [0.55, 1],
      FROND_UV,
      0.1 + R() * 0.08,
    );
  }
  return m.build();
}
