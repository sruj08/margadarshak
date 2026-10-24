import type { GameEventType, GameMode, PayloadOf } from "@margdarshak/game-core/schema";

/** Records one event for the round's item (the parent binds `item`). */
export type Emit = <T extends GameEventType>(type: T, payload: PayloadOf<T>) => void;

export interface RoundProps<R> {
  item: number;
  spec: R;
  seed: number;
  mode: GameMode;
  emit: Emit;
  paused: boolean;
  reducedMotion: boolean;
  screenReaderAlt: boolean;
  /** "Round 1 of 3" etc. */
  heading: string;
  onNext(): void;
}
