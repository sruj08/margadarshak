/**
 * Where a Nazar clip came from (clip.json `origin`, ADR-0013). The API sends it per item (API-34
 * `GameSessionItem.origin`, the replay endpoint's clips): an AI-generated scene carries the
 * "AI-generated scene" label, a filmed clip does not. The label follows the item's own `origin`,
 * never a guess about the whole bank, so a filmed clip is never mislabelled and an unlabelled clip
 * is never presented as AI.
 */
export type ClipOrigin = "filmed" | "ai_generated";

/**
 * The origin to label a clip with: the item's `origin` when it says one, else null (no label).
 * Always null for the placeholder timeline, which carries its own "Placeholder clip" label.
 */
export function clipOrigin(item: unknown, media: "video" | "placeholder"): ClipOrigin | null {
  if (media === "placeholder") return null;
  const raw =
    item !== null && typeof item === "object" ? (item as { origin?: unknown }).origin : undefined;
  return raw === "filmed" || raw === "ai_generated" ? raw : null;
}

/** True when any played item is an AI-generated scene (results and share lines say so). */
export function anyAiScene(items: readonly unknown[], media: "video" | "placeholder"): boolean {
  return items.some((it) => clipOrigin(it, media) === "ai_generated");
}
