/**
 * The study score card (FIELD_STUDY §4.3 step 7, §7.1 export mapping), computed from the three
 * session results the host saved on this phone: `hpt_score` = primary test score over the 10 test
 * clips (0–100), `pre_mean` / `post_mean` = mean per-clip score (0–10) over the test and the fresh
 * clips, and the LL quiz score. Every number comes from the scorer (server, or the provisional device
 * replay); nothing is invented here. Pure.
 */

export interface ScoreLike {
  raw: number;
  max: number;
}

export interface CheckedLike {
  server_checked: boolean;
  score: ScoreLike;
}

export interface StudyScore {
  /** 0–100, or null when the test session has no result yet. */
  hpt: number | null;
  preMean: number | null;
  postMean: number | null;
  ll: ScoreLike | null;
  /** Below Kerala's announced pass mark (60/100), null when unknown. */
  belowPass: boolean | null;
  /** Any of the results not server-checked yet. */
  provisional: boolean;
}

export const KERALA_PASS = 60;

const perClip = (s: ScoreLike | undefined): number | null =>
  s && s.max > 0 ? Math.round((s.raw / s.max) * 100) / 10 : null;

export function studyScore(args: {
  test: CheckedLike | null;
  fresh: CheckedLike | null;
  ll: ScoreLike | null;
}): StudyScore {
  const t = args.test?.score;
  const hpt = t && t.max > 0 ? Math.round((t.raw / t.max) * 100) : null;
  return {
    hpt,
    preMean: perClip(t),
    postMean: perClip(args.fresh?.score),
    ll: args.ll,
    belowPass: hpt === null ? null : hpt < KERALA_PASS,
    provisional: [args.test, args.fresh].some((c) => c !== null && !c.server_checked),
  };
}

export interface ReplayClipLike {
  ordinal: number;
  windows: readonly { hazard_id: string; a_ms: number }[];
  analysis?: {
    hazards: readonly { hazard_id: string; tap_mt: number | null; late_s: number | null }[];
  };
}

/**
 * The two test clips to replay (FIELD_STUDY §4.3 step 5): the latest taps first (they teach the
 * most), then missed hazards, then the earliest clips. Deterministic for a given session.
 */
export function pickFeedbackClips<T extends ReplayClipLike>(clips: readonly T[], n = 2): T[] {
  const withHazard = clips.filter((c) => c.windows.length > 0);
  const lateOf = (c: T) =>
    Math.max(
      ...(c.analysis?.hazards ?? []).map((h) =>
        h.late_s !== null && h.tap_mt !== null ? h.late_s : -1,
      ),
      -1,
    );
  const missed = (c: T) => (c.analysis?.hazards ?? []).some((h) => h.tap_mt === null);
  const rank = (c: T) => {
    const late = lateOf(c);
    if (late > 0) return [0, -late];
    if (missed(c)) return [1, 0];
    return [2, 0];
  };
  return [...withHazard]
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return (
        (ra[0] as number) - (rb[0] as number) ||
        (ra[1] as number) - (rb[1] as number) ||
        a.ordinal - b.ordinal
      );
    })
    .slice(0, n);
}
