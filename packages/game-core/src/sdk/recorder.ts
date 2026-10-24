// EventRecorder (GAME_SDK §4.2, §5.4). Pure: the host injects the clock (`now`, ms, e.g. from
// performance.now()) and the sink (IndexedDB queue on the device, an array in tests). The recorder
// assigns `seq` and relative `t`, quantises sampled streams, validates every payload against the
// schema and enforces the bounds: event cap (sampled streams dropped first, then the session ends with
// `event_cap`), tap-rate cap (20/s, extra taps dropped and counted) and payload bounds.
import { EVENT_BOUNDS, GameEvent, type GameEventType, type PayloadOf } from "../schema/events.ts";
import type { SessionContext } from "../schema/manifest.ts";

export interface EventSink {
  write(event: GameEvent): void;
  flush?(): void;
}

export interface EmitOptions {
  /** Media time in ms (video games); rounded to an integer. */
  mt?: number;
  /** Index into ctx.items. */
  item?: number;
}

export interface RecorderStats {
  count: number;
  droppedTaps: number;
  droppedSamples: number;
  rejected: number;
  capped: boolean;
}

export interface EventRecorder {
  /** Records one event; returns it, or null when dropped (cap, tap rate) or invalid. */
  emit<T extends GameEventType>(
    type: T,
    payload: PayloadOf<T>,
    opts?: EmitOptions,
  ): GameEvent | null;
  /**
   * Sampled streams: `lane_pos` keeps one sample per 10 Hz bucket; `input` keeps one sample per
   * 60 Hz step and only when the value changed (delta encoding).
   */
  sample<T extends "lane_pos" | "input">(
    stream: T,
    payload: PayloadOf<T>,
    opts?: EmitOptions,
  ): GameEvent | null;
  flush(): void;
  stats(): RecorderStats;
}

export interface RecorderOptions {
  /** Clock in ms; the first call fixes t = 0. */
  now: () => number;
  /** Manifest budget; defaults to the schema bound (5000). */
  maxEvents?: number;
  /** Slots kept back for item_end / session_end once sampled streams are cut. */
  reserve?: number;
}

const SAMPLED: ReadonlySet<GameEventType> = new Set(["lane_pos", "input"]);

export function createEventRecorder(
  ctx: Pick<SessionContext, "sid">,
  sink: EventSink,
  opts: RecorderOptions,
): EventRecorder {
  const maxEvents = Math.min(opts.maxEvents ?? EVENT_BOUNDS.maxEvents, EVENT_BOUNDS.maxEvents);
  const reserve = opts.reserve ?? 16;
  const t0 = opts.now();
  let seq = 0;
  let lastT = 0;
  let ended = false;
  const recentTaps: number[] = [];
  const lastBucket = new Map<string, number>();
  let lastInputKey = "";
  const stats: RecorderStats = {
    count: 0,
    droppedTaps: 0,
    droppedSamples: 0,
    rejected: 0,
    capped: false,
  };

  const clock = (): number => {
    const t = Math.max(lastT, Math.round(opts.now() - t0));
    lastT = t;
    return t;
  };

  function write(
    type: GameEventType,
    payload: unknown,
    o: EmitOptions | undefined,
    t: number,
  ): GameEvent | null {
    const raw: Record<string, unknown> = { sid: ctx.sid, seq, t, type, p: payload };
    if (o?.mt !== undefined) raw["mt"] = Math.max(0, Math.round(o.mt));
    if (o?.item !== undefined) raw["item"] = o.item;
    const parsed = GameEvent.safeParse(raw);
    if (!parsed.success) {
      stats.rejected++;
      return null;
    }
    sink.write(parsed.data);
    seq++;
    stats.count++;
    if (parsed.data.type === "session_end") ended = true;
    return parsed.data;
  }

  function admit(type: GameEventType, t: number): boolean {
    if (ended) return false;
    const used = stats.count;
    if (SAMPLED.has(type) && used >= maxEvents - reserve) {
      stats.droppedSamples++;
      return false;
    }
    if (used >= maxEvents - 1 && type !== "session_end") {
      // Last slot: end the session so the stream stays well-formed.
      stats.capped = true;
      write("session_end", { reason: "event_cap" }, undefined, t);
      return false;
    }
    if (type === "tap") {
      while (recentTaps.length > 0 && t - (recentTaps[0] as number) >= 1000) recentTaps.shift();
      if (recentTaps.length >= EVENT_BOUNDS.maxTapsPerSecond) {
        stats.droppedTaps++;
        return false;
      }
      recentTaps.push(t);
    }
    return true;
  }

  return {
    emit(type, payload, o) {
      const t = clock();
      return admit(type, t) ? write(type, payload, o, t) : null;
    },
    sample(stream, payload, o) {
      const t = clock();
      const hz = stream === "lane_pos" ? EVENT_BOUNDS.sampleHz : 60;
      const bucket = Math.floor((t * hz) / 1000);
      if (lastBucket.get(stream) === bucket) {
        stats.droppedSamples++;
        return null;
      }
      if (stream === "input") {
        const key = JSON.stringify(payload);
        if (key === lastInputKey) return null;
        lastInputKey = key;
      }
      if (!admit(stream, t)) return null;
      lastBucket.set(stream, bucket);
      return write(stream, payload, o, t);
    },
    flush() {
      sink.flush?.();
    },
    stats() {
      return { ...stats };
    },
  };
}

/** A sink that collects events in memory (tests, previews). */
export function arraySink(): EventSink & { events: GameEvent[] } {
  const events: GameEvent[] = [];
  return { events, write: (e) => events.push(e) };
}
