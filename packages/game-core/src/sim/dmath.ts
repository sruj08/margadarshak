// Deterministic transcendental functions (GAME_SDK §6.2 rule 3).
// ECMAScript does not require Math.sin/cos/atan2/exp/pow/log to be bit-identical across engines
// (V8 vs JavaScriptCore). These ports of the fdlibm kernels use only + − × ÷, Math.sqrt, Math.round,
// Math.floor and IEEE-754 bit access through DataView, all of which are exactly specified, so every
// engine produces the same bits. JS never fuses multiply-add, so evaluation order is fixed too.
// Accuracy: within a few ulp of the correctly rounded result on the domains the sims use.

const PIO2_1 = 1.5707963267341256; // first 33 bits of π/2
const PIO2_1T = 6.077100506506192e-11; // π/2 − PIO2_1
const INV_PIO2 = 6.366197723675814e-1; // 2/π
export const PI = Math.PI;
export const HALF_PI = Math.PI / 2;

/** Largest |x| accepted by dsin/dcos; Cody–Waite reduction stays exact well beyond this. */
export const TRIG_DOMAIN = 1e6;

function kernelSin(x: number): number {
  const z = x * x;
  const v = z * x;
  const r =
    0.00833333333332249 +
    z *
      (-0.0001984126982985795 +
        z * (0.0000027557313707070068 + z * (-2.5050760253406863e-8 + z * 1.58969099521155e-10)));
  return x + v * (-0.16666666666666632 + z * r);
}

function kernelCos(x: number): number {
  const z = x * x;
  const r =
    z *
    (0.0416666666666666 +
      z *
        (-0.001388888888887411 +
          z *
            (0.00002480158728947673 +
              z *
                (-2.7557314351390663e-7 +
                  z * (2.087572321298175e-9 + z * -1.1359647557788195e-11)))));
  return 1 - (0.5 * z - z * r);
}

function reduce(x: number): { n: number; r: number } {
  if (!Number.isFinite(x) || Math.abs(x) > TRIG_DOMAIN) {
    throw new RangeError(`dmath: argument out of domain: ${x}`);
  }
  const n = Math.round(x * INV_PIO2);
  const r = x - n * PIO2_1 - n * PIO2_1T;
  return { n, r };
}

/** sin(x), deterministic. */
export function dsin(x: number): number {
  if (x === 0) return x;
  const { n, r } = reduce(x);
  switch (((n % 4) + 4) % 4) {
    case 0:
      return kernelSin(r);
    case 1:
      return kernelCos(r);
    case 2:
      return -kernelSin(r);
    default:
      return -kernelCos(r);
  }
}

/** cos(x), deterministic. */
export function dcos(x: number): number {
  const { n, r } = reduce(x);
  switch (((n % 4) + 4) % 4) {
    case 0:
      return kernelCos(r);
    case 1:
      return -kernelSin(r);
    case 2:
      return -kernelCos(r);
    default:
      return kernelSin(r);
  }
}

/** tan(x) = dsin/dcos (deterministic; unbounded near odd multiples of π/2). */
export function dtan(x: number): number {
  return dsin(x) / dcos(x);
}

const ATAN_HI = [0.4636476090008061, 0.7853981633974483, 0.982793723247329, 1.5707963267948966];
const ATAN_LO = [
  2.2698777452961687e-17, 3.061616997868383e-17, 1.3903311031230998e-17, 6.123233995736766e-17,
];
const AT = [
  0.3333333333333293, -0.19999999999876483, 0.14285714272503466, -0.11111110405462356,
  0.09090887133436507, -0.0769187620504483, 0.06661073137387531, -0.058335701337905735,
  0.049768779946159324, -0.036531572744216916, 0.016285820115365782,
];
const at = (i: number): number => AT[i] as number;

/** atan(x), deterministic (fdlibm s_atan.c). */
export function datan(x: number): number {
  if (Number.isNaN(x)) return x;
  const neg = x < 0;
  let a = neg ? -x : x;
  if (a >= 73786976294838210000) return neg ? -HALF_PI : HALF_PI; // 2^66
  let id = -1;
  if (a < 0.4375) {
    if (a < 7.450580596923828e-9) return x; // 2^-27: atan(x) == x
  } else if (a < 1.1875) {
    if (a < 0.6875) {
      id = 0;
      a = (2 * a - 1) / (2 + a);
    } else {
      id = 1;
      a = (a - 1) / (a + 1);
    }
  } else if (a < 2.4375) {
    id = 2;
    a = (a - 1.5) / (1 + 1.5 * a);
  } else {
    id = 3;
    a = -1 / a;
  }
  const z = a * a;
  const w = z * z;
  const s1 = z * (at(0) + w * (at(2) + w * (at(4) + w * (at(6) + w * (at(8) + w * at(10))))));
  const s2 = w * (at(1) + w * (at(3) + w * (at(5) + w * (at(7) + w * at(9)))));
  if (id < 0) {
    const r = a - a * (s1 + s2);
    return neg ? -r : r;
  }
  const r = (ATAN_HI[id] as number) - (a * (s1 + s2) - (ATAN_LO[id] as number) - a);
  return neg ? -r : r;
}

/** atan2(y, x) in (−π, π], deterministic. atan2(0, 0) = 0. */
export function datan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

// ---- IEEE-754 bit helpers (exact, engine-independent) ----
const bits = new DataView(new ArrayBuffer(8));

/** 2^k exactly, for integer k in [−1022, 1023]. */
function pow2(k: number): number {
  bits.setUint32(0, ((k + 1023) << 20) >>> 0);
  bits.setUint32(4, 0);
  return bits.getFloat64(0);
}

const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const INV_LN2 = Math.LOG2E;

/** e^x, deterministic (fdlibm e_exp.c). */
export function dexp(x: number): number {
  if (Number.isNaN(x)) return x;
  if (x > 709.782712893384) return Number.POSITIVE_INFINITY;
  if (x < -745.1332191019411) return 0;
  if (Math.abs(x) < 3.725290298461914e-9) return 1 + x; // 2^-28
  const k = Math.round(x * INV_LN2);
  const hi = x - k * LN2_HI;
  const lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c =
    r -
    t *
      (0.16666666666666602 +
        t *
          (-0.0027777777777015593 +
            t *
              (0.00006613756321437934 +
                t * (-0.0000016533902205465252 + t * 4.1381367970572385e-8))));
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  if (k === 0) return y;
  // Split the scale so subnormal and near-overflow results stay exact steps of ×2.
  if (k > 1023) return y * pow2(1023) * pow2(k - 1023);
  if (k < -1022) return y * pow2(-1022) * pow2(k + 1022);
  return y * pow2(k);
}

/** Natural log, deterministic (fdlibm e_log.c). */
export function dlog(x: number): number {
  if (Number.isNaN(x) || x < 0) return Number.NaN;
  if (x === 0) return Number.NEGATIVE_INFINITY;
  if (x === Number.POSITIVE_INFINITY) return x;
  let k = 0;
  let v = x;
  if (v < 2.2250738585072014e-308) {
    v *= 18014398509481984; // 2^54: normalise subnormals
    k -= 54;
  }
  bits.setFloat64(0, v);
  let hx = bits.getUint32(0);
  k += (hx >>> 20) - 1023;
  hx &= 0x000fffff;
  // Normalise the mantissa m into [√2/2, √2).
  const i = (hx + 0x95f64) & 0x100000;
  bits.setUint32(0, (hx | (i ^ 0x3ff00000)) >>> 0);
  k += i >>> 20;
  const m = bits.getFloat64(0);
  const f = m - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (0.3999999999940942 + w * (0.22222198432149784 + w * 0.15313837699209373));
  const t2 =
    z *
    (0.6666666666666735 +
      w * (0.2857142874366239 + w * (0.1818357216161805 + w * 0.14798198605116586)));
  const R = t2 + t1;
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - (hfsq - (s * (hfsq + R) + k * LN2_LO) - f);
}

/** x^y, deterministic. Small integer exponents use exact repeated squaring. */
export function dpow(x: number, y: number): number {
  if (y === 0) return 1;
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  if (Number.isInteger(y) && Math.abs(y) <= 1024) {
    let result = 1;
    let base = x;
    let e = Math.abs(y);
    while (e > 0) {
      if (e % 2 === 1) result *= base;
      base *= base;
      e = Math.floor(e / 2);
    }
    return y < 0 ? 1 / result : result;
  }
  if (x === 0) return y > 0 ? 0 : Number.POSITIVE_INFINITY;
  if (x < 0) return Number.NaN;
  return dexp(y * dlog(x));
}

/** Degrees → radians (exact constant, deterministic). */
export function degToRad(deg: number): number {
  return deg * (PI / 180);
}

/** Deterministic math namespace (README name). */
export const dmath = {
  dsin,
  dcos,
  dtan,
  datan,
  datan2,
  dexp,
  dlog,
  dpow,
  degToRad,
  PI,
  HALF_PI,
} as const;
