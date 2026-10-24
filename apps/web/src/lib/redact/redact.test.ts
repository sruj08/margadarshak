import { describe, expect, it } from "vitest";
import { findPii, latinDigits, MASK, redact } from "./redact";
import { verhoeffDigit, verhoeffValid } from "./verhoeff";

/** Synthetic Aadhaar-shaped numbers: 11 digits (first 2-9) + Verhoeff check digit. Never real. */
function synthAadhaar(seed: number): string {
  let x = seed * 2654435761;
  let body = String(2 + (seed % 8));
  while (body.length < 11) {
    x = (x * 1103515245 + 12345) % 2147483648;
    body += String(x % 10);
  }
  return body + verhoeffDigit(body);
}

function synthVid(seed: number): string {
  let body = String(1 + (seed % 9));
  let x = seed + 7;
  while (body.length < 15) {
    x = (x * 48271) % 2147483647;
    body += String(x % 10);
  }
  return body + verhoeffDigit(body);
}

const group4 = (s: string, sep: string) => s.match(/.{1,4}/g)?.join(sep) ?? s;
const toDevanagari = (s: string) =>
  s.replace(/\d/g, (d) => String.fromCharCode(0x0966 + Number(d)));

describe("Verhoeff (MD-138)", () => {
  it("validates known check digits", () => {
    expect(verhoeffValid("2363")).toBe(true);
    expect(verhoeffValid("2364")).toBe(false);
    expect(verhoeffDigit("236")).toBe(3);
  });
  it("every synthetic number passes, and a changed digit fails", () => {
    for (let i = 1; i <= 50; i++) {
      const n = synthAadhaar(i);
      expect(verhoeffValid(n)).toBe(true);
      const flipped = n.slice(0, 5) + ((Number(n[5]) + 1) % 10) + n.slice(6);
      expect(verhoeffValid(flipped)).toBe(false);
    }
  });
});

describe("Aadhaar set: zero false negatives (EC-20)", () => {
  const formats: Array<[string, (n: string) => string]> = [
    ["plain", (n) => n],
    ["spaced", (n) => group4(n, " ")],
    ["dashed", (n) => group4(n, "-")],
    ["dotted", (n) => group4(n, ".")],
    ["devanagari", (n) => toDevanagari(group4(n, " "))],
    ["nbsp", (n) => group4(n, " ")],
  ];
  const phrasings = [
    (x: string) => x,
    (x: string) => `mera aadhaar ${x} hai`,
    (x: string) => `Aadhaar no: ${x}`,
    (x: string) => `मेरा आधार नंबर ${x} है`,
    (x: string) => `uid ${x}, please check`,
    (x: string) => `(${x})`,
  ];
  let count = 0;
  for (let i = 1; i <= 40; i++) {
    const n = synthAadhaar(i * 31);
    const [label, fmt] = formats[i % formats.length] as [string, (n: string) => string];
    const phrase = phrasings[i % phrasings.length] as (x: string) => string;
    const text = phrase(fmt(n));
    count++;
    it(`#${i} ${label}: ${text}`, () => {
      const r = redact(text);
      expect(r.findings.map((f) => f.kind)).toContain("aadhaar");
      expect(latinDigits(r.text)).not.toContain(n.slice(-4));
      expect(r.text).toContain(MASK.aadhaar);
    });
  }
  it("covers at least 40 Aadhaar-shaped inputs", () => expect(count).toBeGreaterThanOrEqual(40));
});

describe("VID, OTP, phone, email", () => {
  it("masks a 16-digit VID", () => {
    const vid = synthVid(3);
    const r = redact(`VID ${group4(vid, " ")} hai`);
    expect(r.findings[0]?.kind).toBe("vid");
    expect(r.text).toBe(`VID ${MASK.vid} hai`);
  });

  const otps: Array<[string, string]> = [
    ["English", "Your OTP is 482913"],
    ["colon", "OTP: 4829"],
    ["Hinglish after", "mera otp 482913 hai"],
    ["Hinglish before", "482913 wala otp aaya"],
    ["code", "verification code 771204"],
    ["Hindi", "ओटीपी ४८२९१३ आया है"],
    ["Hindi code", "कोड 561234 डाला"],
    ["spaced", "OTP 4 8 2 9 1 3"],
    ["password", "SMS password 90817264"],
    ["pin", "PIN 4821 bata do"],
  ];
  for (const [label, text] of otps) {
    it(`masks an OTP-like code (${label})`, () => {
      const r = redact(text);
      expect(r.findings.some((f) => f.kind === "otp")).toBe(true);
      expect(r.text).toContain(MASK.otp);
    });
  }

  const phones = [
    "call me on 9876543210",
    "+91 98765 43210",
    "+91-9876543210",
    "098765-43210",
    "mera number ९८७६५४३२१० hai",
    "0091 8123456789",
    "whatsapp 70123 45678",
  ];
  for (const text of phones) {
    it(`masks a mobile number: ${text}`, () => {
      const r = redact(text);
      expect(r.findings.some((f) => f.kind === "phone")).toBe(true);
      expect(r.text).toContain(MASK.phone);
    });
  }

  it("masks an email address", () => {
    const r = redact("mail kabir.p01@example.com pe bhejo");
    expect(r.text).toBe(`mail ${MASK.email} pe bhejo`);
  });
});

describe("leaves ordinary text alone (no false alarms)", () => {
  const clean = [
    "Fees kitni hai?",
    "Papa ke liye licence chahiye, woh 52 saal ke hain",
    "Test 30 din baad hoga",
    "My LL was issued on 12 10 2026",
    "pin code 180001 Jammu",
    "Class 10 marksheet",
    "Bike 150 cc, scooter 110 cc",
    "Room 2026 in block 4",
    "application number 2026001234",
    "12 questions, 9 correct",
  ];
  for (const text of clean) {
    it(`no change: ${text}`, () => {
      const r = redact(text);
      expect(r.changed).toBe(false);
      expect(r.text).toBe(text);
    });
  }

  it("a 12-digit number that fails Verhoeff is not called an Aadhaar", () => {
    const n = synthAadhaar(5);
    const bad = n.slice(0, 11) + ((Number(n[11]) + 1) % 10);
    expect(findPii(bad).some((f) => f.kind === "aadhaar")).toBe(false);
  });

  it("a 12-digit number starting with 0 or 1 is not an Aadhaar", () => {
    const body = "12345678901";
    const n = body + verhoeffDigit(body);
    expect(findPii(n).some((f) => f.kind === "aadhaar")).toBe(false);
  });
});

describe("multiple findings keep the surrounding text", () => {
  it("masks Aadhaar and OTP in one sentence", () => {
    const a = synthAadhaar(9);
    const r = redact(`aadhaar ${a} aur otp 123456`);
    expect(r.findings.map((f) => f.kind)).toEqual(["aadhaar", "otp"]);
    expect(r.text).toBe(`aadhaar ${MASK.aadhaar} aur otp ${MASK.otp}`);
  });
});
