import { SdRound } from "@margdarshak/game-core/schema";
import type { HostSession } from "@/features/games/types";

export interface SdItem {
  /** Index into ctx.items (the event `item`). */
  index: number;
  ref: string;
  round: SdRound;
}

/**
 * The rounds of a session, in play order: each item's client-safe document (`items[i].public`, a
 * round config with no answers in it), else the device session's content. Validated with
 * game-core's schema; an item that does not parse is dropped (the session still plays).
 */
export function sdItems(session: HostSession): SdItem[] {
  const content =
    session.deviceContent?.gameId === "stopping_distance" ? session.deviceContent : null;
  return session.items.flatMap((it, i) => {
    const parsed = SdRound.safeParse(it.public ?? content?.rounds[i]);
    return parsed.success ? [{ index: i, ref: it.item_ref, round: parsed.data }] : [];
  });
}
