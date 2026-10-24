/**
 * Squad invite links (UI_SPEC_LEARN_GAMES §7.4): `/{locale}/s/{squadId}.{inviteCode}` on our own
 * domain only. API-39 join needs both the squad ID (path) and the invite code (body), so the token
 * carries both; neither is personal data. Squad names pass a PII filter (no phone numbers, emails or
 * long digit runs) before they are sent; the server applies its own filter too (422).
 */

const SQUAD_ID = /^sqd_[0-9A-Z]{6,26}$/;
const CODE = /^SQ-[0-9A-Z]{2,12}$/;

export function inviteToken(squadId: string, code: string): string {
  return `${squadId}.${code}`;
}

export function parseInvite(token: string): { squadId: string; code: string } | null {
  const raw = decodeURIComponent(token);
  const dot = raw.indexOf(".");
  if (dot < 0) return null;
  const squadId = raw.slice(0, dot);
  const code = raw.slice(dot + 1);
  return SQUAD_ID.test(squadId) && CODE.test(code) ? { squadId, code } : null;
}

export type NameProblem = "short" | "long" | "pii";

export function nameProblem(name: string, max = 40): NameProblem | null {
  const v = name.trim();
  if (v.length < 2) return "short";
  if (v.length > max) return "long";
  if (/\d{5,}/.test(v.replace(/[\s-]/g, "")) || /@|https?:|www\./i.test(v)) return "pii";
  return null;
}

/** Curated name ideas (place + number), so nobody has to type a name. */
export const NAME_IDEAS = ["Gandhi Nagar", "Lal Chowk", "Rajbagh", "Bahu Fort", "Residency Road"];

export function suggestName(seed: number): string {
  const place = NAME_IDEAS[Math.abs(seed) % NAME_IDEAS.length] ?? "Gandhi Nagar";
  return `${place} ${(Math.abs(seed) % 9) + 1}`;
}

const INVITES_KEY = "md.squads.invites.v1";

interface KnownInvite {
  code: string;
  expiresAt: string | null;
}

function readInvites(): Record<string, KnownInvite> {
  try {
    const raw = localStorage.getItem(INVITES_KEY);
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? (v as Record<string, KnownInvite>) : {};
  } catch {
    return {};
  }
}

/**
 * API-39 sends `invite_code` only in the create response (the server keeps a hash), so the
 * creator's phone remembers it to show the invite link later. Not personal data.
 */
export function rememberInvite(squadId: string, code: string, expiresAt?: string): void {
  try {
    const all = readInvites();
    all[squadId] = { code, expiresAt: expiresAt ?? null };
    localStorage.setItem(INVITES_KEY, JSON.stringify(all));
  } catch {
    // storage blocked: the link is shown once, on the create screen
  }
}

/** The invite code this phone kept for a squad, while it is still valid. */
export function rememberedInvite(squadId: string, now = Date.now()): string | null {
  const known = readInvites()[squadId];
  if (!known || !CODE.test(known.code)) return null;
  if (known.expiresAt && Date.parse(known.expiresAt) <= now) return null;
  return known.code;
}

export function forgetInvite(squadId: string): void {
  try {
    const all = readInvites();
    delete all[squadId];
    localStorage.setItem(INVITES_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}
