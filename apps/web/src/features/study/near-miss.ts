import { findPii, redact } from "@/lib/redact/redact";

/**
 * Client-side privacy scan of the optional near-miss line (FIELD_STUDY §4.3 step 8, D-21). It uses
 * the shared redaction in src/lib/redact (Aadhaar, VID, OTP, phone, e-mail; read-only here) and adds
 * two study-specific masks: Indian vehicle registration numbers and driving-licence numbers. The
 * server scans again and refuses (422 PROHIBITED_FIELD) anything it still finds, including names and
 * exact places, which no client pattern can catch reliably.
 */

export const NEAR_MISS_MAX = 140;

export type NearMissKind = "aadhaar" | "vid" | "otp" | "phone" | "email" | "plate" | "licence";

const MASKS: Record<"plate" | "licence", string> = {
  plate: "[vehicle number]",
  licence: "[licence number]",
};

/** e.g. JK02AB1234, JK 02 AB 1234, jk-02-ab-1234, KL 7 C 123 (BH series too: 22 BH 1234 AA). */
const PLATE_RE =
  /\b(?:[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,3}[\s-]?\d{3,4}|\d{2}[\s-]?BH[\s-]?\d{4}[\s-]?[A-Z]{1,2})\b/gi;
/** e.g. JK02 20190001234, DL-1420110012345 (two letters + 13 digits, optional separators). */
const LICENCE_RE = /\b[A-Z]{2}[\s-]?\d{2}[\s-]?(?:19|20)\d{2}[\s-]?\d{7}\b/gi;

export interface NearMissScan {
  /** The text that may be sent (masked, trimmed, at most 140 characters). */
  text: string;
  changed: boolean;
  kinds: NearMissKind[];
}

export function scanNearMiss(input: string): NearMissScan {
  const kinds = new Set<NearMissKind>();
  let text = input.normalize("NFC");
  // Licence numbers first: they would otherwise be half-matched as plates or phone numbers.
  text = text.replace(LICENCE_RE, () => {
    kinds.add("licence");
    return MASKS.licence;
  });
  text = text.replace(PLATE_RE, (m) => {
    // A plate needs letters and digits; plain words or numbers are left alone.
    if (!/[A-Z]/i.test(m) || !/\d/.test(m)) return m;
    kinds.add("plate");
    return MASKS.plate;
  });
  for (const f of findPii(text)) kinds.add(f.kind);
  text = redact(text).text.trim().slice(0, NEAR_MISS_MAX);
  return { text, changed: kinds.size > 0, kinds: [...kinds] };
}
