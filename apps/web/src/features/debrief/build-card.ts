import {
  type DebriefCard,
  type DebriefCatalogue,
  type DebriefHistory,
  type FactsPack,
  generateFindings,
  renderTemplateCard,
} from "@margdarshak/game-core/debrief";
import type { SessionResult } from "@margdarshak/game-core/schema";
import type { SessionRecord } from "@/features/games/results-store";

/** Card generator tag (DebriefCard.generator_version, ≤ 40 chars). */
export const GENERATOR_VERSION = "game-core 0.1.0 web";

/**
 * The SessionResult the debrief reads: the server's (`result`) when it sent one, else rebuilt from
 * the checked fields (score, findings, integrity are the server's once checked; the device's while
 * provisional) and the session context.
 */
export function sessionResultOf(rec: SessionRecord): SessionResult | null {
  const c = rec.checked;
  if (!c) return null;
  if (c.result)
    return { ...c.result, score: c.score, findings: c.findings, integrity: c.integrity };
  return {
    sid: rec.sid,
    gameId: rec.gameId,
    gameVersion: rec.manifest.version,
    scoringVersion: rec.manifest.scoringVersion,
    seed: rec.ctx.seed,
    seedOrigin: rec.ctx.seedOrigin,
    difficulty: rec.ctx.difficulty,
    mode: rec.ctx.mode,
    score: c.score,
    findings: c.findings,
    evidence: [],
    calibration: null,
    integrity: c.integrity,
    replay: { seed: rec.ctx.seed, inputs: "" },
  };
}

const meanLate = (rec: SessionRecord): number | null => {
  const hz = (rec.checked?.nazar?.analysis ?? []).flatMap((c) => c.hazards);
  const credited = hz.filter((h) => h.credit > 0 && h.late_s !== null);
  if (credited.length === 0) return null;
  return credited.reduce((s, h) => s + (h.late_s ?? 0), 0) / credited.length;
};

/**
 * Debrief history from earlier sessions of the same game on this phone (DEBRIEF_SPEC §5.1):
 * previous findings (newest first) and, for Nazar, the mean late_s baseline for NAZ_IMPROVED
 * (SessionResult only carries the worst late_s, so the mean comes from the analysed clips).
 */
export function historyFor(rec: SessionRecord, all: readonly SessionRecord[]): DebriefHistory {
  const earlier = all
    .filter((r) => r.gameId === rec.gameId && r.sid !== rec.sid && r.savedAt < rec.savedAt)
    .sort((a, b) => b.savedAt - a.savedAt);
  const history: {
    lastDebriefs: { findingIds: string[] }[];
    nazarLateS?: { firstSessions: number[]; current: number; speedKmh: number };
  } = {
    lastDebriefs: earlier
      .filter((r) => r.checked)
      .map((r) => ({ findingIds: (r.checked?.findings ?? []).map((f) => f.findingId) })),
  };
  if (rec.gameId === "nazar") {
    const current = meanLate(rec);
    const first = [...earlier]
      .reverse()
      .map(meanLate)
      .filter((x): x is number => x !== null);
    const speed = rec.checked?.findings.find((f) => typeof f.facts["speed_kmh"] === "number")
      ?.facts["speed_kmh"];
    if (current !== null && first.length >= 3)
      history.nazarLateS = {
        firstSessions: first,
        current,
        speedKmh: typeof speed === "number" ? speed : 30,
      };
  }
  return history;
}

/** Facts pack + the template card ("Auto notes"), rendered on the device from the findings. */
export function buildTemplateCard(args: {
  result: SessionResult;
  history: DebriefHistory;
  catalogue: DebriefCatalogue;
  locale: "en" | "hi";
  now: string;
}): { pack: FactsPack; card: DebriefCard } {
  const pack = generateFindings(args.result, args.history, args.catalogue, {
    locale: args.locale,
  });
  const card = renderTemplateCard(pack, args.catalogue, args.locale, {
    now: args.now,
    sid: args.result.sid,
    generatorVersion: GENERATOR_VERSION,
  });
  return { pack, card };
}

/** Web route for a card's drill (`margdarshak://play/<game>?drill=…&level=…`). */
export function drillHref(deeplink: string, drillId: string): string {
  const m = /^margdarshak:\/\/play\/([a-z_]+)/.exec(deeplink);
  const game = m?.[1] ?? "nazar";
  const slug = game.replaceAll("_", "-");
  const mode = /-MOCK$/.test(drillId) ? "mock" : /-OCCL-/.test(drillId) ? "learn" : "practice";
  const level = /[?&]level=(\d)/.exec(deeplink)?.[1];
  const q = new URLSearchParams({ mode, drill: drillId });
  if (level) q.set("level", level);
  return `/learn/practise/${slug}?${q.toString()}`;
}
