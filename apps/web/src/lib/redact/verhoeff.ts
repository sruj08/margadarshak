/**
 * Verhoeff checksum (the check digit UIDAI uses for Aadhaar numbers and VIDs). Pure, no deps.
 */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
] as const;

const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;

const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9] as const;

function digitsOf(s: string): number[] | null {
  if (!/^\d+$/.test(s)) return null;
  return [...s].map((c) => c.charCodeAt(0) - 48);
}

/** True when the digit string (check digit last) passes the Verhoeff check. */
export function verhoeffValid(num: string): boolean {
  const ds = digitsOf(num);
  if (!ds || ds.length < 2) return false;
  let c = 0;
  const rev = ds.reverse();
  for (let i = 0; i < rev.length; i++) {
    c = D[c]?.[P[i % 8]?.[rev[i] as number] as number] as number;
  }
  return c === 0;
}

/** The Verhoeff check digit for a digit string (used by tests to build synthetic numbers). */
export function verhoeffDigit(num: string): number {
  const ds = digitsOf(num);
  if (!ds) throw new TypeError("digits only");
  let c = 0;
  const rev = ds.reverse();
  for (let i = 0; i < rev.length; i++) {
    c = D[c]?.[P[(i + 1) % 8]?.[rev[i] as number] as number] as number;
  }
  return INV[c] as number;
}
