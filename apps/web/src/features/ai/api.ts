"use client";

import type { components } from "@margdarshak/api-client/schema";
import {
  API_BASE,
  API_MODE,
  API_TENANT,
  apiLocale,
  ensureApiSession,
  isOnline,
  sendApi,
} from "@/features/games/api";

type Schemas = components["schemas"];
export type CoachPlan = Schemas["CoachPlan"];
export type SignSnapResult = Schemas["SignSnapResult"];
export type ScreenDecode = Schemas["ScreenDecode"];
export type CommentaryResult = Schemas["CommentaryResult"];
export type VoiceServerMessage = Schemas["VoiceServerMessage"];

/**
 * The P3 AI surfaces (API-40/42/74/75/76/77). Every call is optional for the product: on an
 * error the screen keeps its manual path (EC-29), so these return a tagged result instead of
 * throwing. `code` is the problem+json code (CONSENT_REQUIRED, FEATURE_DISABLED, …).
 */
export type AiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string | null; reason: "mock" | "offline" | "problem" };

function problemCode(body: unknown): string | null {
  return typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>)["code"] === "string"
    ? ((body as Record<string, unknown>)["code"] as string)
    : null;
}

async function jsonCall<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<AiResult<T>> {
  if (API_MODE !== "real") return { ok: false, status: 0, code: null, reason: "mock" };
  if (!isOnline()) return { ok: false, status: 0, code: null, reason: "offline" };
  try {
    await ensureApiSession();
    const res = await sendApi(method, path, body === undefined ? {} : { body });
    if (res.status >= 200 && res.status < 300) return { ok: true, data: res.body as T };
    return { ok: false, status: res.status, code: problemCode(res.body), reason: "problem" };
  } catch {
    return { ok: false, status: 0, code: null, reason: "offline" };
  }
}

/** Multipart upload with the same headers as the JSON transport (CSRF header, tenant, locale). */
async function formCall<T>(path: string, form: FormData, timeoutMs = 20_000): Promise<AiResult<T>> {
  if (API_MODE !== "real") return { ok: false, status: 0, code: null, reason: "mock" };
  if (!isOnline()) return { ok: false, status: 0, code: null, reason: "offline" };
  try {
    await ensureApiSession();
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json, application/problem+json",
        "X-Tenant": API_TENANT,
        "Accept-Language": apiLocale(),
        "X-Requested-With": "margdarshak",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (res.ok) return { ok: true, data: body as T };
    return { ok: false, status: res.status, code: problemCode(body), reason: "problem" };
  } catch {
    return { ok: false, status: 0, code: null, reason: "offline" };
  }
}

export function getCoachPlan(familyMemberId?: string): Promise<AiResult<CoachPlan>> {
  const q = familyMemberId ? `?family_member_id=${encodeURIComponent(familyMemberId)}` : "";
  return jsonCall<CoachPlan>("GET", `/v1/me/coach-plan${q}`);
}

export function saveCoachIntention(
  day: string,
  time: string,
  drillId: string,
): Promise<AiResult<unknown>> {
  return jsonCall("POST", "/v1/me/coach-plan/intentions", { day, time, drill_id: drillId });
}

export function snapSign(image: Blob, moving: boolean): Promise<AiResult<SignSnapResult>> {
  const form = new FormData();
  form.set("image", image, "sign.jpg");
  form.set("moving", moving ? "true" : "false");
  return formCall<SignSnapResult>("/v1/signs/snap", form);
}

export function decodeScreenshot(image: Blob, ocrText: string): Promise<AiResult<ScreenDecode>> {
  const form = new FormData();
  form.set("image", image, "status.jpg");
  if (ocrText.trim()) form.set("ocr_text", ocrText.slice(0, 4000));
  return formCall<ScreenDecode>("/v1/decode/screenshot", form);
}

export function scoreCommentary(
  sid: string,
  ordinal: number,
  audio: Blob,
  lang: "hi" | "en" | "doi",
): Promise<AiResult<CommentaryResult>> {
  const form = new FormData();
  form.set("audio", audio, "commentary.webm");
  form.set("clip_ordinal", String(ordinal));
  form.set("lang", lang);
  return formCall<CommentaryResult>(`/v1/games/sessions/${sid}/commentary`, form, 45_000);
}

export function createVoiceTicket(): Promise<
  AiResult<{ ticket: string; expires_at: string; live: boolean }>
> {
  return jsonCall("POST", "/v1/voice/ticket");
}

/** API-40 socket URL; the tenant rides in `state` because a browser WebSocket cannot set headers. */
export function voiceSocketUrl(lang: "hi" | "en" | "doi"): string | null {
  if (API_MODE !== "real") return null;
  const base = API_BASE || (typeof location !== "undefined" ? location.origin : "");
  return `${base.replace(/^http/, "ws")}/v1/voice?state=${API_TENANT}&lang=${lang}`;
}

export function sendAIFeedback(
  agent: "debrief" | "tutor" | "coach" | "voice" | "decoder" | "signsnap" | "scam",
  itemId: string,
  helpful: boolean,
): Promise<AiResult<unknown>> {
  return jsonCall("POST", "/v1/ai/feedback", { agent, item_id: itemId, helpful });
}
