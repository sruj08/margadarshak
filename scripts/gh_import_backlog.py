#!/usr/bin/env python3
"""Import docs/08-project/BACKLOG.md into GitHub Issues with the gh CLI.

Margdarshak (team Chanakya). Standard library only; needs `gh` (authenticated) for --apply.

Usage
  python scripts/gh_import_backlog.py --check                 # validate the backlog, no network
  python scripts/gh_import_backlog.py --plan-tables           # print per-phase task tables (for IMPLEMENTATION_PLAN)
  python scripts/gh_import_backlog.py --dry-run               # show what would be created (default)
  python scripts/gh_import_backlog.py --apply --repo OWNER/margdarshak [--phase P0] [--epics]

What --apply does (idempotent; safe to re-run)
  1. Creates/updates labels: phase:*, epic:*, owner:*, est:*, ec:*, game:*, n8n:*, rw:*, agent:*.
  2. Creates milestones P0..P7 if missing.
  3. Creates one issue per MD ticket whose title "MD-xxx · ..." does not already exist.
  4. Second pass: rewrites "Depends on" with #issue numbers once every ticket exists.
  5. With --epics, creates one tracking issue per epic with a task list of its tickets.

Never run --apply before gate G0 (confirmed hackathon start; MD-001).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from collections import OrderedDict, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKLOG = ROOT / "docs" / "08-project" / "BACKLOG.md"

PHASES = OrderedDict([
    ("P0", "Foundations"), ("P1", "Journey core"), ("P2", "Learning and games core"),
    ("P3", "AI layer"), ("P4", "DL test and after"), ("P5", "Ecosystem"),
    ("P6", "Hardening"), ("P7", "Adoption"),
])
PHASE_RANGES = {"P0": (1, 99), "P1": (101, 199), "P2": (201, 299), "P3": (301, 399),
                "P4": (401, 499), "P5": (501, 599), "P6": (601, 699), "P7": (701, 799)}
EST_DAYS = {"XS": 0.5, "S": 1, "M": 2.5, "L": 4.5, "XL": 8}
OWNERS = {"PD", "FE", "BE", "AG"}
COLORS = {"phase": "1d76db", "epic": "5319e7", "owner": "0e8a16", "est": "c2e0c6",
          "ec": "d93f0b", "game": "fbca04", "n8n": "ff7619", "rw": "0052cc", "agent": "b60205"}

TICKET_RE = re.compile(r"^### (MD-\d{3}) · (.+)$")
EPIC_RE = re.compile(r"^## (EP-\d{2}[a-z]?) · (.+)$")
META_RE = re.compile(r"^- \*\*Meta:\*\* (.+)$")


def parse(path: Path = BACKLOG):
    tickets: "OrderedDict[str, dict]" = OrderedDict()
    epics: "OrderedDict[str, str]" = OrderedDict()
    current = None
    for line in path.read_text(encoding="utf-8").splitlines():
        m_ep = EPIC_RE.match(line)
        if m_ep:
            epics[m_ep.group(1)] = m_ep.group(2)
        m = TICKET_RE.match(line)
        if m:
            current = {"id": m.group(1), "title": m.group(2).strip(), "body": [], "meta": {}}
            tickets[current["id"]] = current
            continue
        if line.startswith("## ") or line.startswith("---"):
            current = None
            continue
        if current is None:
            continue
        current["body"].append(line)
        mm = META_RE.match(line)
        if mm:
            for part in mm.group(1).split(" · "):
                if "=" in part:
                    k, v = part.split("=", 1)
                    current["meta"][k.strip()] = v.strip()
    for t in tickets.values():
        meta = t["meta"]
        deps = meta.get("depends", "—")
        t["depends"] = [] if deps in ("—", "-", "") else [d.strip() for d in deps.split(",")]
        t["refs"] = [r.strip() for r in meta.get("refs", "").split(",") if r.strip() and r.strip() != "—"]
        t["owners"] = [o for o in meta.get("owner", "").split("+") if o]
        t["body_text"] = "\n".join(t["body"]).strip()
    return tickets, epics


def expand_refs(refs):
    """Expand 'EC-01..EC-20' style ranges."""
    out = []
    for r in refs:
        m = re.match(r"^([A-Z]+)-(\d+)\.\.([A-Z]+)-(\d+)$", r)
        if m and m.group(1) == m.group(3):
            width = len(m.group(2))
            for i in range(int(m.group(2)), int(m.group(4)) + 1):
                out.append(f"{m.group(1)}-{i:0{width}d}")
        else:
            out.append(r)
    return out


def check(tickets, epics) -> int:
    errors = []
    for tid, t in tickets.items():
        meta = t["meta"]
        for key in ("phase", "epic", "owner", "estimate", "depends", "refs"):
            if key not in meta:
                errors.append(f"{tid}: missing meta '{key}'")
        n = int(tid[3:])
        ph = meta.get("phase")
        if 801 <= n <= 830:
            if ph not in PHASES:
                errors.append(f"{tid}: bad phase {ph}")
        elif ph in PHASE_RANGES:
            lo, hi = PHASE_RANGES[ph]
            if not lo <= n <= hi:
                errors.append(f"{tid}: number outside {ph} range {lo}..{hi}")
        else:
            errors.append(f"{tid}: bad phase {ph}")
        if meta.get("estimate") not in EST_DAYS:
            errors.append(f"{tid}: bad estimate {meta.get('estimate')}")
        if not t["owners"] or any(o not in OWNERS for o in t["owners"]):
            errors.append(f"{tid}: bad owner {meta.get('owner')}")
        if t["owners"] and t["owners"][0] == "AG":
            errors.append(f"{tid}: an AI agent cannot be the accountable owner")
        if meta.get("epic") not in epics:
            errors.append(f"{tid}: unknown epic {meta.get('epic')}")
        for d in t["depends"]:
            if d not in tickets:
                errors.append(f"{tid}: depends on unknown {d}")
        if "**Acceptance:**" not in t["body_text"]:
            errors.append(f"{tid}: no acceptance criteria")
    # cycle check
    state = {}

    def visit(x, stack):
        if state.get(x) == 1:
            errors.append("dependency cycle: " + " -> ".join(stack + [x]))
            return
        if state.get(x) == 2:
            return
        state[x] = 1
        for d in tickets[x]["depends"]:
            if d in tickets:
                visit(d, stack + [x])
        state[x] = 2

    for tid in tickets:
        visit(tid, [])
    # coverage
    all_refs = set()
    for t in tickets.values():
        all_refs.update(expand_refs(t["refs"]))
    required = (
        [f"F-{i:02d}" for i in list(range(1, 18)) + list(range(20, 29)) + list(range(30, 34))
         + [40, 41, 42] + list(range(50, 59))]
        + [f"EC-{i:02d}" for i in range(1, 31)]
        + [f"M-{i:02d}" for i in range(1, 10)]
        # W2–W6, W10, W11 moved to the backend notifier (ADR-0006)
        + [f"W{i}" for i in [1, 7, 8, 9, 12, 13, 14, 15, 16, 17, 18]]
        + [f"G{i}" for i in range(1, 11)]
        + [f"RW-{i}" for i in range(1, 5)]
    )
    missing = [r for r in required if r not in all_refs]
    if missing:
        errors.append("coverage gaps: " + ", ".join(missing))
    for e in errors:
        print("ERROR", e)
    print(f"{len(tickets)} tickets, {len(epics)} epics, {len(errors)} errors")
    return 1 if errors else 0


def plan_tables(tickets) -> None:
    by_phase = defaultdict(list)
    for t in tickets.values():
        by_phase[t["meta"]["phase"]].append(t)
    for ph, name in PHASES.items():
        rows = by_phase.get(ph, [])
        days = sum(EST_DAYS[t["meta"]["estimate"]] for t in rows)
        per_owner = defaultdict(float)
        agent = 0.0
        for t in rows:
            per_owner[t["owners"][0]] += EST_DAYS[t["meta"]["estimate"]]
            if "AG" in t["owners"]:
                agent += EST_DAYS[t["meta"]["estimate"]]
        print(f"\n#### {ph} task table ({len(rows)} tickets, ~{days:.0f} ideal person-days; "
              + ", ".join(f"{o} {v:.0f}" for o, v in sorted(per_owner.items()))
              + f"; agent-assisted {agent:.0f})\n")
        print("| ID | Task | Epic | Owner | Est | Depends on |")
        print("|---|---|---|---|---|---|")
        for t in rows:
            deps = ", ".join(t["depends"]) or "—"
            print(f"| {t['id']} | {t['title']} | {t['meta']['epic']} | {t['meta']['owner']} | "
                  f"{t['meta']['estimate']} | {deps} |")


def labels_for(t):
    meta = t["meta"]
    labels = [f"phase:{meta['phase']}", f"epic:{meta['epic']}", f"est:{meta['estimate']}"]
    labels += [f"owner:{o}" for o in t["owners"]]
    for r in expand_refs(t["refs"]):
        if r.startswith("EC-"):
            labels.append(f"ec:{r}")
        elif re.fullmatch(r"G\d+", r):
            labels.append(f"game:{r}")
        elif re.fullmatch(r"W\d+", r):
            labels.append(f"n8n:{r}")
        elif r.startswith("RW-"):
            labels.append(f"rw:{r}")
        elif re.fullmatch(r"M-\d{2}", r):
            labels.append(f"agent:{r}")
    if "AG" in t["owners"]:
        labels.append("agent-ready")
    return sorted(set(labels))


def gh(args, repo, capture=True):
    cmd = ["gh"] + args + (["--repo", repo] if repo and args[0] not in ("api",) else [])
    res = subprocess.run(cmd, capture_output=capture, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"gh failed: {' '.join(cmd)}\n{res.stderr}")
    return res.stdout


def apply(tickets, epics, repo, phase_filter, make_epics, dry):
    selected = [t for t in tickets.values() if not phase_filter or t["meta"]["phase"] == phase_filter]
    all_labels = sorted({lab for t in selected for lab in labels_for(t)})
    if dry:
        print(f"[dry-run] would ensure {len(all_labels)} labels, {len(PHASES)} milestones, "
              f"{len(selected)} issues")
        for t in selected[:10]:
            print(f"  {t['id']} · {t['title']}  labels={labels_for(t)}  milestone={t['meta']['phase']}")
        print("  ...")
        return
    for lab in all_labels:
        prefix = lab.split(":")[0]
        gh(["label", "create", lab, "--force", "--color", COLORS.get(prefix, "ededed")], repo)
    existing_ms = json.loads(gh(["api", f"repos/{repo}/milestones?state=all&per_page=100"], None))
    ms_titles = {m["title"] for m in existing_ms}
    for ph, name in PHASES.items():
        title = f"{ph} {name}"
        if title not in ms_titles:
            gh(["api", f"repos/{repo}/milestones", "-f", f"title={title}"], None)
    issues = json.loads(gh(["issue", "list", "--state", "all", "--limit", "2000",
                            "--json", "number,title"], repo))
    number_of = {}
    for i in issues:
        m = re.match(r"^(MD-\d{3}) · ", i["title"])
        if m:
            number_of[m.group(1)] = i["number"]
    for t in selected:
        if t["id"] in number_of:
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
            f.write(t["body_text"] + "\n\n_Imported from docs/08-project/BACKLOG.md._\n")
            body_path = f.name
        args = ["issue", "create", "--title", f"{t['id']} · {t['title']}", "--body-file", body_path,
                "--milestone", f"{t['meta']['phase']} {PHASES[t['meta']['phase']]}"]
        for lab in labels_for(t):
            args += ["--label", lab]
        url = gh(args, repo).strip()
        number_of[t["id"]] = int(url.rstrip("/").split("/")[-1])
        print("created", t["id"], url)
    # second pass: dependency links
    for t in selected:
        if not t["depends"]:
            continue
        links = ", ".join(f"#{number_of[d]} ({d})" if d in number_of else d for d in t["depends"])
        body = t["body_text"] + f"\n\n**Depends on:** {links}\n\n_Imported from docs/08-project/BACKLOG.md._\n"
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
            f.write(body)
            body_path = f.name
        gh(["issue", "edit", str(number_of[t["id"]]), "--body-file", body_path], repo)
    if make_epics:
        titles = {i["title"] for i in issues}
        for ep, name in epics.items():
            title = f"{ep} · {name}"
            if title in titles:
                continue
            items = [t for t in selected if t["meta"]["epic"] == ep]
            if not items:
                continue
            body = "\n".join(f"- [ ] #{number_of[t['id']]} {t['id']} · {t['title']}" for t in items)
            with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
                f.write(body)
                body_path = f.name
            gh(["issue", "create", "--title", title, "--body-file", body_path,
                "--label", f"epic:{ep}"], repo)
            print("created epic", ep)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--plan-tables", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--repo")
    ap.add_argument("--phase", choices=list(PHASES))
    ap.add_argument("--epics", action="store_true")
    a = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass
    tickets, epics = parse()
    if a.check:
        return check(tickets, epics)
    if a.plan_tables:
        plan_tables(tickets)
        return 0
    if a.apply and not a.repo:
        ap.error("--apply needs --repo OWNER/NAME")
    if check(tickets, epics):
        print("fix the backlog before importing")
        return 1
    apply(tickets, epics, a.repo, a.phase, a.epics, dry=not a.apply)
    return 0


if __name__ == "__main__":
    sys.exit(main())
