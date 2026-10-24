import { BsItem } from "@margdarshak/game-core/schema";
import type { HostSession } from "@/features/games/types";

export interface BsPlayItem {
  /** Index into ctx.items (the event `item`). */
  index: number;
  ref: string;
  spec: BsItem;
}

/**
 * The session's Blind Spot items in play order: each item's client-safe document
 * (`items[i].public`), else the device session's content, validated with game-core's schema.
 */
export function bsItems(session: HostSession): BsPlayItem[] {
  const content = session.deviceContent?.gameId === "blind_spot" ? session.deviceContent : null;
  return session.items.flatMap((it, i) => {
    const parsed = BsItem.safeParse(it.public ?? content?.items[i]);
    return parsed.success ? [{ index: i, ref: it.item_ref, spec: parsed.data }] : [];
  });
}
