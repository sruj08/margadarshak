// biome-ignore-all lint/performance/noBarrelFile: this file is the `./sdk` subpath entry point.
export { canonicalDigest, canonicalJSON, sha256Hex, sha256HexBytes } from "./canonical.ts";
export type {
  EndReason,
  GameHost,
  GameModule,
  MediaClock,
  SessionResultPreview,
} from "./interfaces.ts";
export type { LifecycleEvent, LifecycleState } from "./lifecycle.ts";
export { ABANDON_AFTER_MS, SessionLifecycle } from "./lifecycle.ts";
export type {
  EmitOptions,
  EventRecorder,
  EventSink,
  RecorderOptions,
  RecorderStats,
} from "./recorder.ts";
export { arraySink, createEventRecorder } from "./recorder.ts";
export {
  base64Decode,
  base64Encode,
  decodeReplay,
  decodeReplayAsync,
  encodeReplay,
  encodeReplayGzip,
  eventsDigest,
  MAX_DECODED_BYTES,
  REPLAY_ENCODINGS,
  validateEvents,
} from "./replay-codec.ts";
