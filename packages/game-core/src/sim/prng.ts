// Seeded PRNG (GAME_SDK §6.1). mulberry32 uses only 32-bit integer ops (Math.imul, shifts), so it
// is bit-identical everywhere. Sub-streams are derived per concern from a label hash, so adding a
// new random concern never shifts the numbers an existing concern draws.

export type Rng = () => number;

/** mulberry32: returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** murmur3 32-bit finaliser. */
function fmix32(h0: number): number {
  let h = h0 >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const utf8 = new TextEncoder();

/** FNV-1a over the seed's 4 little-endian bytes then the label's UTF-8 bytes, finalised. */
export function hash32(seed: number, label: string): number {
  let h = 0x811c9dc5;
  const s = seed >>> 0;
  for (let i = 0; i < 4; i++) {
    h ^= (s >>> (8 * i)) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  for (const b of utf8.encode(label)) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h);
}

/** An independent stream for one concern, e.g. `subStream(seed, "traffic")`. */
export function subStream(seed: number, label: string): Rng {
  return mulberry32(hash32(seed, label));
}

/** Uniform integer in [min, max] (inclusive). */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Picks one element uniformly. */
export function pick<T>(rng: Rng, xs: readonly T[]): T {
  if (xs.length === 0) throw new RangeError("pick from an empty list");
  return xs[randInt(rng, 0, xs.length - 1)] as T;
}

/** Deterministic Fisher–Yates shuffle (returns a copy). */
export function shuffle<T>(rng: Rng, xs: readonly T[]): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
