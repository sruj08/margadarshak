import { verhoeffValid } from "./verhoeff";

/**
 * Client-side PII redaction (MD-138, EC-20, D-07). Runs on any free text before it leaves the
 * device (voice transcript, "tell us" box, screenshots' OCR text, logs). It masks:
 *   - Aadhaar numbers: 12 digits (spaces, dashes or dots between groups; Latin or Devanagari
 *     digits), first digit 2-9, Verhoeff check digit valid
 *   - VIDs: 16 digits, Verhoeff valid
 *   - OTP-like codes: 4-8 digits next to "OTP", "code", "PIN", "password" (English, Hindi, Hinglish)
 *   - Indian mobile numbers (+91 / 0 prefixes) and email addresses
 * and reports what it removed so the UI can say why (copy key voice.pii_redacted).
 */

export type PiiKind = "aadhaar" | "vid" | "otp" | "phone" | "email";

export interface Finding {
  kind: PiiKind;
  start: number;
  end: number;
}

export interface RedactResult {
  text: string;
  findings: Finding[];
  changed: boolean;
}

export const MASK: Record<PiiKind, string> = {
  aadhaar: "[AADHAAR REMOVED]",
  vid: "[VID REMOVED]",
  otp: "[OTP REMOVED]",
  phone: "[PHONE REMOVED]",
  email: "[EMAIL REMOVED]",
};

const DEVANAGARI_ZERO = 0x0966;

/** Devanagari digits (०-९) to Latin, same length, so indices stay aligned with the input. */
export function latinDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out +=
      code >= DEVANAGARI_ZERO && code <= DEVANAGARI_ZERO + 9 ? String(code - DEVANAGARI_ZERO) : ch;
  }
  return out;
}

const SEP = "[ \\u00a0.\\-]?";
// Digit runs with optional single separators between digits, not glued to other digits.
const RUN = (n: number) => new RegExp(`(?<![\\d])\\d(?:${SEP}\\d){${n - 1}}(?![\\d])`, "g");

const OTP_WORDS = /(otp|o\.t\.p|one[- ]time|code|pin|passcode|password|पासवर्ड|ओटीपी|कोड|पिन)/i;

/** "PIN code 180001" is a postal code, not a PIN. */
const POSTAL = /(pin ?code|postal|पिन ?कोड|पिनकोड)\W*$/i;

function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

function overlaps(a: Finding, list: Finding[]): boolean {
  return list.some((b) => a.start < b.end && b.start < a.end);
}

export function findPii(input: string): Finding[] {
  const text = latinDigits(input);
  const found: Finding[] = [];

  // Emails first (they may contain digits).
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    found.push({ kind: "email", start: m.index, end: m.index + m[0].length });
  }

  // VID: 16 digits, Verhoeff valid.
  for (const m of text.matchAll(RUN(16))) {
    const f: Finding = { kind: "vid", start: m.index, end: m.index + m[0].length };
    if (!overlaps(f, found) && verhoeffValid(onlyDigits(m[0]))) found.push(f);
  }

  // Aadhaar: 12 digits, first 2-9, Verhoeff valid.
  for (const m of text.matchAll(RUN(12))) {
    const d = onlyDigits(m[0]);
    const f: Finding = { kind: "aadhaar", start: m.index, end: m.index + m[0].length };
    if (!overlaps(f, found) && /^[2-9]/.test(d) && verhoeffValid(d)) found.push(f);
  }

  // Indian mobile numbers: optional +91 / 91 / 0, then 10 digits starting 6-9.
  const phone = /(?<![\d+])(?:(?:\+|00)?91[ \u00a0-]?|0)?[6-9](?:[ \u00a0-]?\d){9}(?!\d)/g;
  for (const m of text.matchAll(phone)) {
    const f: Finding = { kind: "phone", start: m.index, end: m.index + m[0].length };
    if (!overlaps(f, found)) found.push(f);
  }

  // OTP-like: 4-8 digits within ~24 characters of an OTP word (either side).
  for (const m of text.matchAll(/(?<!\d)\d(?:[  ]?\d){3,7}(?!\d)/g)) {
    const f: Finding = { kind: "otp", start: m.index, end: m.index + m[0].length };
    if (overlaps(f, found)) continue;
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    const after = text.slice(f.end, f.end + 24);
    if (POSTAL.test(before)) continue;
    if (OTP_WORDS.test(before) || OTP_WORDS.test(after)) found.push(f);
  }

  return found.sort((a, b) => a.start - b.start);
}

export function redact(input: string): RedactResult {
  const findings = findPii(input);
  if (findings.length === 0) return { text: input, findings, changed: false };
  let out = "";
  let at = 0;
  for (const f of findings) {
    out += input.slice(at, f.start) + MASK[f.kind];
    at = f.end;
  }
  out += input.slice(at);
  return { text: out, findings, changed: true };
}

/** True when any value in a flat record looks like an Aadhaar number, VID or OTP (forms, EC-20). */
export function containsIdentityNumber(value: string): boolean {
  return findPii(value).some((f) => f.kind === "aadhaar" || f.kind === "vid" || f.kind === "otp");
}
