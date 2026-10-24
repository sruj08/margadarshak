// Margdarshak-Signature, the same scheme as services/workflows/src/lib/hmac.ts and the Go side
// (services/api/internal/platform/hmacsig):
//
//   Margdarshak-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>
//
// A timestamp outside ±300 s is stale; the comparison is timing-safe; a signature that was already
// accepted is rejected (bounded in-memory replay cache), so a retry must be signed again.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "Margdarshak-Signature";
export const SIGNATURE_WINDOW_SECONDS = 300;

export function mac(secret: string, ts: string, body: string | Uint8Array): string {
  return createHmac("sha256", secret).update(ts).update(".").update(body).digest("hex");
}

/** Header value for `body` signed at unix second `unixSeconds` (tests, the CLI, local tooling). */
export function sign(secret: string, unixSeconds: number, body: string | Uint8Array): string {
  const ts = String(Math.floor(unixSeconds));
  return `t=${ts},v1=${mac(secret, ts, body)}`;
}

export type VerifyFailure = "missing" | "malformed" | "stale" | "mismatch" | "replayed";
export type VerifyResult =
  | { ok: true; ts: number; sig: string }
  | { ok: false; reason: VerifyFailure };

/** Checks a header against the raw body bytes; does not consult the replay cache. */
export function verify(
  secret: string,
  header: string | null | undefined,
  body: string | Uint8Array,
  nowSeconds: number,
  windowSeconds = SIGNATURE_WINDOW_SECONDS,
): VerifyResult {
  if (header === undefined || header === null || header === "")
    return { ok: false, reason: "missing" };
  let ts = "";
  let sig = "";
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) return { ok: false, reason: "malformed" };
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") ts = v;
    else if (k === "v1") sig = v;
  }
  if (!/^\d{1,12}$/.test(ts) || !/^[0-9a-fA-F]{64}$/.test(sig))
    return { ok: false, reason: "malformed" };
  const t = Number(ts);
  if (Math.abs(nowSeconds - t) > windowSeconds) return { ok: false, reason: "stale" };
  const want = Buffer.from(mac(secret, ts, body), "utf8");
  const got = Buffer.from(sig.toLowerCase(), "utf8");
  if (want.length !== got.length || !timingSafeEqual(want, got))
    return { ok: false, reason: "mismatch" };
  return { ok: true, ts: t, sig: sig.toLowerCase() };
}

/**
 * Remembers accepted signatures until they could no longer pass the time window, so each signed
 * request is accepted once. Bounded: expired entries go first, then the oldest.
 */
export class ReplayCache {
  readonly #seen = new Map<string, number>();
  readonly #max: number;
  readonly #ttl: number;
  constructor(maxEntries: number, ttlSeconds = 2 * SIGNATURE_WINDOW_SECONDS) {
    this.#max = maxEntries;
    this.#ttl = ttlSeconds;
  }
  get size(): number {
    return this.#seen.size;
  }
  /** Records `sig`; returns false when it was already accepted (a replay). */
  accept(sig: string, nowSeconds: number): boolean {
    const exp = this.#seen.get(sig);
    if (exp !== undefined && exp > nowSeconds) return false;
    this.#evict(nowSeconds);
    this.#seen.set(sig, nowSeconds + this.#ttl);
    return true;
  }
  #evict(nowSeconds: number): void {
    for (const [k, exp] of this.#seen) {
      if (exp <= nowSeconds) this.#seen.delete(k);
      else break; // insertion order ≈ expiry order
    }
    while (this.#seen.size >= this.#max) {
      const oldest = this.#seen.keys().next();
      if (oldest.done === true) break;
      this.#seen.delete(oldest.value);
    }
  }
}
