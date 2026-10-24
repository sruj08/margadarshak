/**
 * Placeholder clip media (mock mode): no clip media is published yet (human task MD-216), so the
 * device session's clips point at a same-origin route that answers with this many bytes. The
 * player preloads them exactly like a real MP4 (EC-18 path, throttling tests) and then draws a
 * labelled placeholder timeline instead of a video.
 */
export const PLACEHOLDER_CLIP_BYTES = 96 * 1024;
export const PLACEHOLDER_CLIP_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * sha256 of the placeholder body (PLACEHOLDER_CLIP_BYTES zero bytes). The dev and demo clip seed
 * (services/api seed clips.go) publishes sample clips whose renditions are exactly this body, so a
 * server session whose clips all carry this hash and size is shown on the labelled placeholder
 * timeline instead of a video element that could never play it.
 */
export const PLACEHOLDER_CLIP_SHA256 =
  "3a3ed164e42500a1c5b2d0093f0a813d27dc50d038f330cc100a7e70ece2e6e4";

/** True for an item whose media is the placeholder body (by size and hash, never by name). */
export function isPlaceholderClip(item: { kind?: string; bytes?: number; sha256?: string }) {
  return (
    item.kind === "clip" &&
    item.bytes === PLACEHOLDER_CLIP_BYTES &&
    item.sha256?.toLowerCase() === PLACEHOLDER_CLIP_SHA256
  );
}
