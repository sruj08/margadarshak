import type { ShareCardPublic } from "@/features/games/api-types";

/**
 * Server-only: the public share-card JSON (`GET /v1/share-cards/{id}`, API-57 delta) for the card
 * page and its Open Graph image (decision D3). Scores always come from the server; without an API
 * (mock mode) only the labelled sample card `shc_DEMO01` exists.
 */
export type CardFetch =
  | { k: "ok"; card: ShareCardPublic; sample: boolean }
  | { k: "not_found" }
  | { k: "gone" }
  | { k: "error" };

export const SHARE_ID_RE = /^[A-Za-z0-9_-]{6,32}$/;
export const SAMPLE_CARD_ID = "shc_DEMO01";

function apiBase(): string | null {
  const internal = process.env["API_INTERNAL_HOSTPORT"];
  if (internal) return internal.startsWith("http") ? internal : `http://${internal}`;
  const pub = process.env["NEXT_PUBLIC_API_URL"] || process.env["NEXT_PUBLIC_API_BASE_URL"];
  return pub && process.env["NEXT_PUBLIC_API_MOCK"] !== "1" ? pub : null;
}

const SAMPLE: ShareCardPublic = {
  share_card_id: SAMPLE_CARD_ID,
  kind: "nazar",
  content: {
    display_name: "KS",
    nazar_score: 64,
    counted_sessions: 3,
    rank: "mohalla",
    kerala_line: true,
    percentile: null,
    calibration: null,
  },
  image_url: "",
  tagline_key: "share.rewards_anticipation_not_speed",
  footer_key: "share.footer_practice_not_licence_test",
  kerala_line_key: "share.kerala_announced_pass_mark",
};

export async function fetchShareCard(id: string): Promise<CardFetch> {
  if (!SHARE_ID_RE.test(id)) return { k: "not_found" };
  const base = apiBase();
  if (!base)
    return id === SAMPLE_CARD_ID ? { k: "ok", card: SAMPLE, sample: true } : { k: "not_found" };
  try {
    const res = await fetch(
      `${base.replace(/\/+$/, "")}/v1/share-cards/${encodeURIComponent(id)}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (res.status === 404) return { k: "not_found" };
    if (res.status === 410) return { k: "gone" };
    if (!res.ok) return { k: "error" };
    const card = (await res.json()) as ShareCardPublic;
    return { k: "ok", card, sample: false };
  } catch {
    return { k: "error" };
  }
}
