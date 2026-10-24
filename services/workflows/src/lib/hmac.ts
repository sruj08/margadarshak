// Margdarshak-Signature: the same scheme as the Go side (services/api/internal/platform/hmacsig):
//
//   Margdarshak-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + body)>
//
// The API rejects a timestamp outside ±300 s and any signature it has already accepted (replay
// cache), so a retried request must be signed again with a newer timestamp (see api.ts).
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "Margdarshak-Signature";
export const SIGNATURE_WINDOW_SECONDS = 300;

export function mac(secret: string, ts: string, body: string): string {
  return createHmac("sha256", secret).update(ts).update(".").update(body).digest("hex");
}

/** Header value for `body` signed at unix second `unixSeconds`. */
export function sign(secret: string, unixSeconds: number, body: string): string {
  const ts = String(Math.floor(unixSeconds));
  return `t=${ts},v1=${mac(secret, ts, body)}`;
}

export type VerifyResult = { ok: true; ts: number } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

/** Verifies a header the way the Go verifier does (used by tests and local tooling). */
export function verify(
  secret: string,
  header: string | null | undefined,
  body: string,
  nowSeconds: number,
  windowSeconds = SIGNATURE_WINDOW_SECONDS,
): VerifyResult {
  if (!header) return { ok: false, reason: "missing" };
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
  if (!ts || !sig || !/^\d+$/.test(ts)) return { ok: false, reason: "malformed" };
  const t = Number(ts);
  if (Math.abs(nowSeconds - t) > windowSeconds) return { ok: false, reason: "stale" };
  const want = Buffer.from(mac(secret, ts, body), "utf8");
  const got = Buffer.from(sig.toLowerCase(), "utf8");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "mismatch" };
  return { ok: true, ts: t };
}
