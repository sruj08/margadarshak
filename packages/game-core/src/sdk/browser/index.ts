// biome-ignore-all lint/performance/noBarrelFile: this file is the `./sdk/browser` subpath entry point.
// @margdarshak/game-core/sdk/browser: the device side of the SDK (MD-203). The event queue keyed
// (sid, seq), idempotent sync through a host submit function, pause on visibilitychange and the
// video media clock. Browser APIs are injected as structural types; nothing here imports the DOM.
export type { ContractCheck } from "./contract.ts";
export { queueStoreContract } from "./contract.ts";
export type { FrameScheduler, VideoLike, VisibilityBinding, VisibilitySource } from "./dom.ts";
export { bindVisibility, createMediaClock } from "./dom.ts";
export type { IdbFactoryLike } from "./idb-store.ts";
export { createIndexedDbQueueStore, QUEUE_DB_NAME } from "./idb-store.ts";
export type { QueueSink, SubmitOutcome, SubmitRequest, SyncReport } from "./queue.ts";
export { createQueueSink, endQueuedSession, queueSession, syncQueue } from "./queue.ts";
export type { PutResult, QueuedSession, QueuedSessionStatus, QueueStore } from "./store.ts";
export { createMemoryQueueStore } from "./store.ts";
