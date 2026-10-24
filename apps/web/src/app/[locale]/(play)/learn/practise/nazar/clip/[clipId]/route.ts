import { PLACEHOLDER_CLIP_BYTES, PLACEHOLDER_CLIP_ID_RE } from "@/features/nazar/placeholder";

/**
 * Placeholder clip media for mock mode (no clip media is published yet). Answers a fixed number of
 * zero bytes so the Nazar player's whole-file preload (EC-18) runs for real; the player then draws a
 * labelled placeholder timeline. Never used once API-34 returns real `asset_url`s.
 */
export function GET(_req: Request, ctx: { params: Promise<{ clipId: string }> }) {
  return ctx.params.then(({ clipId }) => {
    if (!PLACEHOLDER_CLIP_ID_RE.test(clipId)) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(PLACEHOLDER_CLIP_BYTES), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(PLACEHOLDER_CLIP_BYTES),
        "Cache-Control": "public, max-age=3600",
        "X-Margdarshak-Placeholder": "1",
        "X-Robots-Tag": "noindex",
      },
    });
  });
}
