"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { encodeAnswers, type LiteAnswer } from "./quiz";

/**
 * The Lite quiz form's Server Action (FRONTEND §9: Lite POSTs go to a Server Action that proxies to
 * the Go API with an idempotency key). It forwards the answers to API-32 with the browser's own
 * session cookie when an API is configured (best effort, 2 s), then redirects to the result page,
 * which scores the practice set on the server. Works with no JavaScript at all.
 */

const API =
  process.env["API_INTERNAL_URL"] ||
  process.env["NEXT_PUBLIC_API_URL"] ||
  process.env["NEXT_PUBLIC_API_BASE_URL"] ||
  "";

function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}

async function forward(answers: readonly LiteAnswer[], nonce: string): Promise<void> {
  if (!API || process.env["NEXT_PUBLIC_API_MOCK"] === "1") return;
  const sid = (await cookies()).get("md_sid")?.value;
  if (!sid) return;
  const now = new Date().toISOString();
  const body = {
    answers: answers
      .filter((a) => a.optionId !== null)
      .map((a) => {
        const [question, variant] = a.itemId.split(":");
        return {
          client_answer_id: `${nonce}:${a.itemId}`,
          card_id: question,
          question_id: question,
          variant_id: variant,
          option_id: a.optionId,
          ...(a.confidence ? { confidence: a.confidence } : {}),
          answered_at: now,
          mode: "practice",
        };
      }),
  };
  try {
    await fetch(`${API.replace(/\/+$/, "")}/v1/learn/answers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `md_sid=${sid}`,
        "Idempotency-Key": `lite-${nonce}`,
        "X-Requested-With": "margdarshak",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // The result page still scores the practice set; nothing is lost but the server copy.
  }
}

export async function submitLiteQuiz(fd: FormData): Promise<void> {
  const locale = field(fd, "locale") === "hi" ? "hi" : "en";
  const kind = field(fd, "kind") === "review" ? "review" : "ll";
  const state = /^[A-Z]{2}$/.test(field(fd, "state")) ? field(fd, "state") : "JK";
  const nonce = /^[\w-]{8,64}$/.test(field(fd, "nonce")) ? field(fd, "nonce") : crypto.randomUUID();
  const ids = fd
    .getAll("q")
    .filter((v): v is string => typeof v === "string")
    .slice(0, 40);
  const answers: LiteAnswer[] = ids.map((itemId) => {
    const opt = field(fd, `a:${itemId}`);
    const conf = field(fd, `c:${itemId}`);
    return {
      itemId,
      optionId: /^[a-f]$/.test(opt) ? opt : null,
      confidence: conf === "50" || conf === "75" || conf === "100" ? conf : null,
    };
  });
  await forward(answers, nonce);
  redirect(
    `/${locale}/lite/learn/result?k=${kind}&s=${state}&a=${encodeURIComponent(encodeAnswers(answers))}`,
  );
}
