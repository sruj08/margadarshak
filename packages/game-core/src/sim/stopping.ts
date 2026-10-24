// Stopping physics for Stopping Distance (GAME_DESIGN §3.7). Teaching values, "real roads vary".
// Total stopping distance = reaction (thinking) distance + braking distance (brief §15: never
// braking alone). Only + − × ÷ and Math.sqrt are used.

export const G = 9.81;

export const kmhToMps = (kmh: number): number => kmh / 3.6;
export const mpsToKmh = (mps: number): number => mps * 3.6;

/** Distance covered during the reaction time (m). */
export function reactionDistance(vMps: number, trS: number): number {
  return vMps * trS;
}

/** Braking distance v²/(2μg) (m). */
export function brakingDistance(vMps: number, mu: number, g = G): number {
  return (vMps * vMps) / (2 * mu * g);
}

/** d_total(v) = v·t_r + v²/(2·μ·g) (m), v in m/s. */
export function totalStoppingDistance(vMps: number, trS: number, mu: number, g = G): number {
  return reactionDistance(vMps, trS) + brakingDistance(vMps, mu, g);
}

/** Highest speed (m/s) that stops within `sightM`: μg·(−t_r + √(t_r² + 2d/(μg))). */
export function maxSafeSpeed(sightM: number, trS: number, mu: number, g = G): number {
  const mg = mu * g;
  return mg * (-trS + Math.sqrt(trS * trS + (2 * sightM) / mg));
}

/** Highest option in 5 km/h steps at or below the max safe speed: 5·⌊v_max_kmh/5⌋. */
export function maxSafeOptionKmh(sightM: number, trS: number, mu: number, g = G): number {
  return 5 * Math.floor(mpsToKmh(maxSafeSpeed(sightM, trS, mu, g)) / 5);
}

/** True when the rider cannot stop within `distM`: v·rt + v²/(2μg) > D. */
export function collides(vMps: number, rtS: number, mu: number, distM: number, g = G): boolean {
  return totalStoppingDistance(vMps, rtS, mu, g) > distM;
}

/** Speed (m/s) on reaching the obstacle: √max(0, v² − 2μg(D − v·rt)) when D > v·rt, else v. */
export function impactSpeed(vMps: number, rtS: number, mu: number, distM: number, g = G): number {
  const reaction = vMps * rtS;
  if (distM <= reaction) return vMps;
  return Math.sqrt(Math.max(0, vMps * vMps - 2 * mu * g * (distM - reaction)));
}

export type WhoBand = "below_50" | "between_50_80" | "80_plus";

/**
 * Impact-speed band from the only two published WHO points (risk under 20% below 50 km/h, about
 * 60% at 80 km/h). No curve is interpolated between them.
 */
export function whoBand(impactKmh: number): WhoBand {
  if (impactKmh < 50) return "below_50";
  if (impactKmh < 80) return "between_50_80";
  return "80_plus";
}
