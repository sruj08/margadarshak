import { ctxFor } from "@margdarshak/game-core/fixtures";
import type { GameContent, GameEvent, GameId, GameMode } from "@margdarshak/game-core/schema";
import { arraySink, createEventRecorder, type EventRecorder } from "@margdarshak/game-core/sdk";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { HostSession, WebGameModule, WebGameProps } from "@/features/games/types";
import gamesEn from "../../../messages/en/games.json";
import simsEn from "../../../messages/en/sims.json";

/** Test-only provider with the `games` and `sims` namespaces (English). */
export function SimsIntl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{ games: gamesEn, sims: simsEn }}
      timeZone="Asia/Kolkata"
    >
      {children}
    </NextIntlClientProvider>
  );
}

/** Fake timers that also drive `performance.now()` (the recorder's and the games' clock). */
export function fakeClock(): void {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"],
  });
}

export interface Harness {
  props: WebGameProps;
  events: GameEvent[];
  recorder: EventRecorder;
  module: () => WebGameModule;
  ended: () => string | null;
}

/**
 * Host stand-in: a real game-core recorder on an array sink (clocked by `performance.now()`), a
 * device-style session whose items carry their documents as `public`, and the module captured
 * from `register`. Lets a test drive the real component and replay what it recorded.
 */
export function harness(o: {
  gameId: GameId;
  mode?: GameMode;
  seed: number;
  refs: string[];
  docs: Record<string, unknown>;
  content: GameContent;
  a11y?: Partial<WebGameProps["a11y"]>;
}): Harness {
  const ctx = ctxFor({
    n: 9001,
    gameId: o.gameId,
    mode: o.mode ?? "practice",
    seed: o.seed,
    items: o.refs.map((ref) => ({ ref, contentVersion: "1" })),
  });
  const sink = arraySink();
  const recorder = createEventRecorder(ctx, sink, { now: () => performance.now() });
  let mod: WebGameModule | null = null;
  let endedWith: string | null = null;
  const session = {
    source: "device",
    media: "placeholder",
    deviceContent: o.content,
    items: o.refs.map((ref) => ({
      item_ref: ref,
      kind: ref.split(":")[0] ?? "item",
      content_version: "1",
      public: o.docs[ref] as Record<string, unknown>,
    })),
  } as unknown as HostSession;
  const props: WebGameProps = {
    ctx,
    session,
    recorder,
    lifecycle: {} as WebGameProps["lifecycle"],
    a11y: {
      reducedMotion: true,
      screenReaderAlt: false,
      tapOnly: true,
      leftHanded: false,
      largeText: false,
      soundOn: false,
      ...o.a11y,
    },
    paused: false,
    register: (m) => {
      mod = m;
      return () => {};
    },
    reportProgress: () => {},
    setCurrentItem: () => {},
    setHud: () => {},
    onEnd: (r) => {
      endedWith = r;
    },
  };
  return {
    props,
    events: sink.events,
    recorder,
    module: () => {
      if (!mod) throw new Error("module not registered");
      return mod;
    },
    ended: () => endedWith,
  };
}

/** What the host does around a run: init, session_start, start. */
export async function hostStart(h: Harness, timingMode: "none" | "sim"): Promise<void> {
  const m = h.module();
  await m.init(h.props.ctx, h.recorder);
  h.recorder.emit("session_start", {
    deviceClass: "mid",
    timingMode,
    a11yModes: [],
    orientation: "portrait",
    mode: h.props.ctx.mode,
  });
  m.start();
}

export function hostEnd(h: Harness): void {
  h.module().end("completed");
  h.recorder.emit("session_end", { reason: "completed" });
}
