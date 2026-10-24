// Session lifecycle state machine (GAME_SDK §4.1). Pure: no timers or DOM; the host feeds events
// (visibility changes, network results) and reads the state.
//
// Loading → Ready → Running ⇄ Paused → Ended → Submitting → Verified | Queued | LocalOnly
// Running → ItemVoided (tab hidden during a timed item) → Running (next item)
// Loading → Failed (asset missing / hash mismatch); Paused → Ended (abandoned after 10 min hidden)

export type LifecycleState =
  | "Loading"
  | "Ready"
  | "Running"
  | "Paused"
  | "ItemVoided"
  | "Ended"
  | "Submitting"
  | "Verified"
  | "Queued"
  | "LocalOnly"
  | "Failed";

export type LifecycleEvent =
  | { type: "assets_verified" }
  | { type: "asset_failed" }
  | { type: "start" }
  | { type: "pause"; cause: "user" | "hidden" | "system" }
  | { type: "resume" }
  /** visibilitychange → hidden; voids the item when one is timed. */
  | { type: "hidden"; timedItem: boolean }
  | { type: "next_item" }
  | { type: "end"; reason: "completed" | "quit" | "timeout" | "event_cap" }
  | { type: "abandon" }
  | { type: "submit"; online: boolean }
  | { type: "verified" }
  | { type: "network_error" }
  | { type: "online" };

/** Hidden this long while paused abandons the session (GAME_SDK §4.1). */
export const ABANDON_AFTER_MS = 10 * 60 * 1000;

const TRANSITIONS: Readonly<
  Record<LifecycleState, Partial<Record<LifecycleEvent["type"], LifecycleState>>>
> = {
  Loading: { assets_verified: "Ready", asset_failed: "Failed" },
  Ready: { start: "Running" },
  Running: { pause: "Paused", end: "Ended" },
  Paused: { resume: "Running", end: "Ended", abandon: "Ended" },
  ItemVoided: { next_item: "Running", resume: "Running", end: "Ended" },
  Ended: {},
  Submitting: { verified: "Verified", network_error: "Queued" },
  Queued: { online: "Submitting" },
  Verified: {},
  LocalOnly: { online: "Submitting" },
  Failed: {},
};

export class SessionLifecycle {
  #state: LifecycleState = "Loading";
  #endReason: string | null = null;
  #voidedItems = 0;

  get state(): LifecycleState {
    return this.#state;
  }
  get endReason(): string | null {
    return this.#endReason;
  }
  get voidedItems(): number {
    return this.#voidedItems;
  }

  /** Whether `event` is allowed in the current state. */
  can(event: LifecycleEvent): boolean {
    return this.#next(event) !== null;
  }

  /** Applies an event; throws on an invalid transition so host bugs surface in tests. */
  send(event: LifecycleEvent): LifecycleState {
    const next = this.#next(event);
    if (next === null) throw new Error(`lifecycle: ${event.type} not allowed in ${this.#state}`);
    if (event.type === "hidden" && event.timedItem) this.#voidedItems++;
    if (event.type === "end") this.#endReason = event.reason;
    if (event.type === "abandon") this.#endReason = "abandoned";
    this.#state = next;
    return next;
  }

  #next(event: LifecycleEvent): LifecycleState | null {
    if (event.type === "hidden") {
      if (this.#state !== "Running") return null;
      return event.timedItem ? "ItemVoided" : "Paused";
    }
    if (event.type === "submit") {
      if (this.#state !== "Ended") return null;
      return event.online ? "Submitting" : "LocalOnly";
    }
    return TRANSITIONS[this.#state][event.type] ?? null;
  }
}
