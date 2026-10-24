// Replay encoding (GAME_SDK §5.3). `mdr1` is a deterministic, pure, synchronous encoding:
//   JSON {"v":1,"sid":…,"r":[rows]} → UTF-8 → base64, where each row is
//   [Δseq, Δt, Δmt | null, item | null, type, payload] and a one-element row [n] repeats the
//   previous row n more times (run-length encoding of identical delta rows).
// `mdr1+gzip` wraps the same bytes in gzip via CompressionStream (Node 22 and browsers), async.
// The digest is always SHA-256 over the canonical JSON of the *decoded* events, never over
// compressed bytes: gzip output differs between implementations, decoded events do not.
import { ReplayError } from "../errors.ts";
import { EVENT_BOUNDS, GameEvent } from "../schema/events.ts";
import type { ReplayEncoding, ReplayPackage } from "../schema/result.ts";
import { canonicalDigest, canonicalJSON } from "./canonical.ts";

type Row = [number, number, number | null, number | null, string, unknown];

// ---- base64 (pure; btoa/atob are Latin-1 only and Buffer is Node-only) ----
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INV = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INV[B64.charCodeAt(i)] = i;

export function base64Encode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n =
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out +=
      B64.charAt((n >>> 18) & 63) +
      B64.charAt((n >>> 12) & 63) +
      B64.charAt((n >>> 6) & 63) +
      B64.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += `${B64.charAt((n >>> 18) & 63)}${B64.charAt((n >>> 12) & 63)}==`;
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += `${B64.charAt((n >>> 18) & 63)}${B64.charAt((n >>> 12) & 63)}${B64.charAt((n >>> 6) & 63)}=`;
  }
  return out;
}

export function base64Decode(s: string): Uint8Array {
  if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s))
    throw new ReplayError("BAD_REPLAY", "invalid base64");
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => {
      const ch = s.charCodeAt(i + k);
      return ch === 61 ? 0 : (B64_INV[ch] as number);
    });
    const n =
      ((c[0] as number) << 18) |
      ((c[1] as number) << 12) |
      ((c[2] as number) << 6) |
      (c[3] as number);
    if (o < out.length) out[o++] = (n >>> 16) & 255;
    if (o < out.length) out[o++] = (n >>> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

const utf8 = new TextEncoder();
const utf8d = new TextDecoder("utf-8", { fatal: true });

/** Validates and orders-checks an event stream; throws BAD_EVENTS. Returns parsed events. */
export function validateEvents(raw: readonly unknown[], sid?: string): GameEvent[] {
  if (raw.length > EVENT_BOUNDS.maxEvents)
    throw new ReplayError("BAD_EVENTS", `more than ${EVENT_BOUNDS.maxEvents} events`);
  const out: GameEvent[] = [];
  let prevSeq = -1;
  let prevT = 0;
  for (const [i, r] of raw.entries()) {
    const parsed = GameEvent.safeParse(r);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ReplayError(
        "BAD_EVENTS",
        `event ${i}: ${issue?.path.join(".") ?? ""} ${issue?.message ?? "invalid"}`,
      );
    }
    const e = parsed.data;
    if (e.seq <= prevSeq)
      throw new ReplayError("BAD_EVENTS", `event ${i}: seq not strictly increasing`);
    if (e.t < prevT) throw new ReplayError("BAD_EVENTS", `event ${i}: t went backwards`);
    if (sid !== undefined && e.sid !== sid)
      throw new ReplayError("BAD_EVENTS", `event ${i}: sid differs from the session`);
    prevSeq = e.seq;
    prevT = e.t;
    out.push(e);
  }
  return out;
}

function toRows(events: readonly GameEvent[]): unknown[] {
  const rows: unknown[] = [];
  let prevSeq = -1;
  let prevT = 0;
  let prevMt = 0;
  let lastKey = "";
  let repeat = 0;
  const flush = (): void => {
    if (repeat > 0) rows.push([repeat]);
    repeat = 0;
  };
  for (const e of events) {
    const row: Row = [
      e.seq - prevSeq,
      e.t - prevT,
      e.mt === undefined ? null : e.mt - prevMt,
      e.item ?? null,
      e.type,
      e.p,
    ];
    prevSeq = e.seq;
    prevT = e.t;
    if (e.mt !== undefined) prevMt = e.mt;
    const key = canonicalJSON(row);
    if (key === lastKey) {
      repeat++;
      continue;
    }
    flush();
    rows.push(row);
    lastKey = key;
  }
  flush();
  return rows;
}

function fromRows(sid: string, rows: readonly unknown[]): unknown[] {
  const out: unknown[] = [];
  let seq = -1;
  let t = 0;
  let mt = 0;
  let prev: Row | null = null;
  const apply = (r: Row): void => {
    const [dSeq, dT, dMt, item, type, p] = r;
    seq += dSeq;
    t += dT;
    const e: Record<string, unknown> = { sid, seq, t, type, p };
    if (dMt !== null) {
      mt += dMt;
      e["mt"] = mt;
    }
    if (item !== null) e["item"] = item;
    out.push(e);
  };
  for (const r of rows) {
    if (!Array.isArray(r)) throw new ReplayError("BAD_REPLAY", "row is not an array");
    if (r.length === 1) {
      const n = r[0];
      if (
        prev === null ||
        typeof n !== "number" ||
        !Number.isInteger(n) ||
        n < 1 ||
        out.length + n > EVENT_BOUNDS.maxEvents
      ) {
        throw new ReplayError("BAD_REPLAY", "bad repeat row");
      }
      for (let k = 0; k < n; k++) apply(prev);
      continue;
    }
    const [dSeq, dT, dMt, item, type] = r as unknown[];
    const isIntOrNull = (x: unknown): boolean =>
      x === null || (typeof x === "number" && Number.isInteger(x));
    if (
      r.length !== 6 ||
      typeof dSeq !== "number" ||
      !Number.isInteger(dSeq) ||
      typeof dT !== "number" ||
      !Number.isInteger(dT) ||
      !isIntOrNull(dMt) ||
      !isIntOrNull(item) ||
      typeof type !== "string"
    ) {
      throw new ReplayError("BAD_REPLAY", "malformed row");
    }
    prev = r as Row;
    apply(prev);
  }
  return out;
}

function packText(events: readonly GameEvent[]): string {
  const sid = events[0]?.sid ?? "00000000-0000-0000-0000-000000000000";
  return canonicalJSON({ v: 1, sid, r: toRows(events) });
}

function unpackText(text: string): unknown[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ReplayError("BAD_REPLAY", "replay body is not JSON");
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc))
    throw new ReplayError("BAD_REPLAY", "replay body is not an object");
  const o = doc as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(",");
  if (
    keys !== "r,sid,v" ||
    o["v"] !== 1 ||
    typeof o["sid"] !== "string" ||
    !Array.isArray(o["r"])
  ) {
    throw new ReplayError("BAD_REPLAY", "unknown replay container");
  }
  return fromRows(o["sid"], o["r"]);
}

/** Canonical digest of an event stream: `sha256:<hex>` over sorted-key canonical JSON. */
export function eventsDigest(events: readonly GameEvent[]): string {
  return canonicalDigest(events);
}

/** Encodes events synchronously with the deterministic `mdr1` encoding. */
export function encodeReplay(events: readonly GameEvent[], seed: number): ReplayPackage {
  const valid = validateEvents(events);
  return {
    telemetryVersion: 1,
    encoding: "mdr1",
    seed,
    inputs: base64Encode(utf8.encode(packText(valid))),
    digest: eventsDigest(valid),
    eventCount: valid.length,
  };
}

function decodeText(
  text: string,
  pkg: Pick<ReplayPackage, "digest" | "eventCount">,
  sid?: string,
): GameEvent[] {
  const events = validateEvents(unpackText(text), sid);
  if (events.length !== pkg.eventCount) {
    throw new ReplayError(
      "BAD_REPLAY",
      `eventCount ${pkg.eventCount} but ${events.length} decoded`,
    );
  }
  const digest = eventsDigest(events);
  if (digest !== pkg.digest)
    throw new ReplayError("DIGEST_MISMATCH", "digest does not match the decoded events");
  return events;
}

/** Decodes an `mdr1` package synchronously, validating every event and the digest. */
export function decodeReplay(pkg: ReplayPackage, sid?: string): GameEvent[] {
  if (pkg.encoding !== "mdr1") {
    throw new ReplayError("BAD_REPLAY", `encoding ${pkg.encoding} needs decodeReplayAsync`);
  }
  let text: string;
  try {
    text = utf8d.decode(base64Decode(pkg.inputs));
  } catch (e) {
    if (e instanceof ReplayError) throw e;
    throw new ReplayError("BAD_REPLAY", "replay body is not UTF-8");
  }
  return decodeText(text, pkg, sid);
}

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit: number,
): Promise<Uint8Array> {
  const reader = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new ReplayError("BAD_REPLAY", "decompressed replay too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Inflated replays above this are rejected (zip-bomb guard). */
export const MAX_DECODED_BYTES = 4 * 1024 * 1024;

/** Encodes with gzip (transport size); the digest is identical to `encodeReplay`'s. */
export async function encodeReplayGzip(
  events: readonly GameEvent[],
  seed: number,
): Promise<ReplayPackage> {
  const plain = encodeReplay(events, seed);
  const gz = await pipe(
    utf8.encode(packText(validateEvents(events))),
    new CompressionStream("gzip"),
    MAX_DECODED_BYTES * 4,
  );
  return { ...plain, encoding: "mdr1+gzip", inputs: base64Encode(gz) };
}

/** Decodes either encoding. */
export async function decodeReplayAsync(pkg: ReplayPackage, sid?: string): Promise<GameEvent[]> {
  if (pkg.encoding === "mdr1") return decodeReplay(pkg, sid);
  let text: string;
  try {
    text = utf8d.decode(
      await pipe(base64Decode(pkg.inputs), new DecompressionStream("gzip"), MAX_DECODED_BYTES),
    );
  } catch (e) {
    if (e instanceof ReplayError) throw e;
    throw new ReplayError("BAD_REPLAY", "replay body is not valid gzip/UTF-8");
  }
  return decodeText(text, pkg, sid);
}

export const REPLAY_ENCODINGS: readonly ReplayEncoding[] = ["mdr1", "mdr1+gzip"];
