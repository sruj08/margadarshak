"use client";

import type {
  GameContent,
  GameEvent,
  GameId,
  GameMode,
  ReplayManifest,
  SessionContext,
} from "@margdarshak/game-core/schema";
import type { CheckedSessionResult, GameSessionItem } from "./api-types";

/**
 * The device's record of finished sessions (no personal data: a session context, bounded events and
 * the checked result). The debrief and replay pages read it: the template card renders from the
 * result's findings on this phone (FRONTEND §8.4), and the replay draws the learner's own taps from
 * the event log (the server sends analysed facts only). Kept for the last few sessions; "Clear this
 * device" removes it with the rest of localStorage.
 */
export interface SessionRecord {
  v: 1;
  sid: string;
  gameId: GameId;
  mode: GameMode;
  source: "server" | "device";
  media: "video" | "placeholder";
  ctx: SessionContext;
  manifest: ReplayManifest;
  items: GameSessionItem[];
  events: GameEvent[];
  checked: CheckedSessionResult | null;
  /** Device sessions: the scoring content the device started with (fixtures, or a game's own bank). */
  deviceContent?: GameContent | null;
  /** Device sessions started with `deviceItems`: their scoring documents and format rows, kept so
   * the provisional preview can always be rebuilt (they never leave the phone). */
  deviceDocs?: {
    docs: Readonly<Record<string, unknown>>;
    formats: Readonly<Record<string, unknown>>;
  };
  status: "verified" | "provisional" | "queued";
  /** Epoch ms (device clock; display ordering only). */
  savedAt: number;
}

const KEY = "md.games.sessions.v1";
const MAX_RECORDS = 8;
type Listener = () => void;
const listeners = new Set<Listener>();

function readAll(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as SessionRecord[]).filter((r) => r?.v === 1) : [];
  } catch {
    return [];
  }
}

function writeAll(records: SessionRecord[]): void {
  const sorted = [...records].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_RECORDS);
  try {
    localStorage.setItem(KEY, JSON.stringify(sorted));
  } catch {
    // Storage full or disabled: drop the oldest half and try once more.
    try {
      localStorage.setItem(KEY, JSON.stringify(sorted.slice(0, Math.ceil(sorted.length / 2))));
    } catch {
      // private mode: records live for this page only
    }
  }
  for (const l of listeners) l();
}

export function saveSessionRecord(record: SessionRecord): void {
  writeAll([record, ...readAll().filter((r) => r.sid !== record.sid)]);
}

export function updateSessionRecord(sid: string, patch: Partial<SessionRecord>): void {
  const all = readAll();
  const i = all.findIndex((r) => r.sid === sid);
  if (i < 0) return;
  all[i] = { ...(all[i] as SessionRecord), ...patch };
  writeAll(all);
}

export function getSessionRecord(sid: string): SessionRecord | null {
  return readAll().find((r) => r.sid === sid) ?? null;
}

/** Newest first. */
export function listSessionRecords(gameId?: GameId): SessionRecord[] {
  const all = readAll().sort((a, b) => b.savedAt - a.savedAt);
  return gameId ? all.filter((r) => r.gameId === gameId) : all;
}

export function subscribeSessionRecords(l: Listener): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) l();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
