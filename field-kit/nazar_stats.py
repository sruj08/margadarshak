"""Nazar field-study analysis (pre-registered; see HYPOTHESES.md).

Usage: python nazar_stats.py sessions.csv [raters.csv]
sessions.csv columns: anon_id,ll_score(0-15),hpt_score(0-100),pre_mean(0-10),post_mean(0-10),
                      median_late_s,speed_kmh,total_s,max_taps_per_s,age_ok(1/0),retake_of(optional anon_id)
raters.csv columns:   clip_id,rater_a_onset_s,rater_b_onset_s
"""
import csv
import math
import statistics
import sys


def wilson(k, n, z=1.96):
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


def pearson(xs, ys):
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    return sxy / math.sqrt(sxx * syy) if sxx and syy else float("nan")


def fisher_ci(r, n, z=1.96):
    if n < 4 or abs(r) >= 1:
        return (float("nan"), float("nan"))
    f = math.atanh(r)
    se = 1 / math.sqrt(n - 3)
    return math.tanh(f - z * se), math.tanh(f + z * se)


def wilcoxon_one_sided(diffs):
    """Signed-rank test, normal approximation, H1: median diff > 0."""
    d = [x for x in diffs if x != 0]
    n = len(d)
    if n < 6:
        return float("nan")
    ranked = sorted(range(n), key=lambda i: abs(d[i]))
    ranks = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and abs(d[ranked[j + 1]]) == abs(d[ranked[i]]):
            j += 1
        for k in range(i, j + 1):
            ranks[ranked[k]] = (i + j) / 2 + 1
        i = j + 1
    w = sum(r for r, x in zip(ranks, d) if x > 0)
    mu = n * (n + 1) / 4
    sd = math.sqrt(n * (n + 1) * (2 * n + 1) / 24)
    zval = (w - mu) / sd
    return 0.5 * math.erfc(zval / math.sqrt(2))


def main():
    rows = list(csv.DictReader(open(sys.argv[1], encoding="utf8")))
    keep = [r for r in rows if r["age_ok"] == "1" and float(r["total_s"]) >= 60
            and float(r["max_taps_per_s"]) <= 3 and not r.get("retake_of")]
    n = len(keep)
    print(f"N after pre-registered exclusions: {n} (of {len(rows)})")
    hpt = [float(r["hpt_score"]) for r in keep]
    ll = [float(r["ll_score"]) for r in keep]
    fail = sum(1 for s in hpt if s < 60)
    lo, hi = wilson(fail, n)
    print(f"H1  below 60/100: {fail}/{n} = {100*fail/n:.0f}%  (95% CI {100*lo:.0f}-{100*hi:.0f}%)")
    r = pearson(ll, hpt)
    clo, chi = fisher_ci(r, n)
    print(f"H2  r(LL mock, Nazar) = {r:.2f}  (95% CI {clo:.2f} to {chi:.2f})")
    late = [float(x["median_late_s"]) for x in keep]
    spd = [float(x["speed_kmh"]) for x in keep]
    ml = statistics.median(late)
    metres = ml * statistics.median(spd) / 3.6
    print(f"    median late = {ml:.2f} s  (~{metres:.0f} m at {statistics.median(spd):.0f} km/h)")
    diffs = [float(x["post_mean"]) - float(x["pre_mean"]) for x in keep]
    print(f"H3  mean gain after feedback = {statistics.fmean(diffs):+.2f}/10 per clip, "
          f"one-sided Wilcoxon p = {wilcoxon_one_sided(diffs):.4f}")
    retakes = {x["retake_of"]: float(x["hpt_score"]) for x in rows if x.get("retake_of")}
    pairs = [(float(x["hpt_score"]), retakes[x["anon_id"]]) for x in keep if x["anon_id"] in retakes]
    if len(pairs) >= 8:
        print(f"    test-retest r = {pearson(*zip(*pairs)):.2f} (n={len(pairs)})")
    if len(sys.argv) > 2:
        rr = list(csv.DictReader(open(sys.argv[2], encoding="utf8")))
        d = [abs(float(x["rater_a_onset_s"]) - float(x["rater_b_onset_s"])) for x in rr]
        print(f"H4  inter-rater median |d onset| = {statistics.median(d):.2f} s over {len(d)} clips")


if __name__ == "__main__":
    main()
