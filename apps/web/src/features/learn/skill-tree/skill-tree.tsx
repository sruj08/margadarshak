"use client";

import type { NodeStates } from "@margdarshak/gamification";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Branch, ModuleSummary } from "../content/curriculum";
import { type NodeView, nodeView } from "../nodes";

/**
 * Skill tree (UI_SPEC_LEARN_GAMES §1.4 SkillTree / SkillNode, GAMIFICATION_ENGINE §3.1). The tree is
 * an ordered list per branch (screen readers get a list, not a picture), each node a 56 px link with
 * a glyph and words for its state: locked (only SK-DL1, until its prerequisites are at learning),
 * learning · N %, mastered, or fading ("Refresh", a soft amber chip, never red).
 */

const BRANCHES: Branch[] = ["ll", "survival", "dl"];

export function NodeGlyph({ v }: { v: NodeView }) {
  const common = { width: 24, height: 24, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  if (!v.canStart)
    return (
      <svg {...common}>
        <rect
          x="5"
          y="11"
          width="14"
          height="10"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  if (v.state === "mastered")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" fill="currentColor" />
        <path
          d="M7.5 12.5l3 3 6-6.5"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  if (v.state === "fading")
    return (
      <svg {...common}>
        <path
          d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  const pct = Math.max(0, Math.min(1, v.mastery ?? 0));
  const len = 2 * Math.PI * 9;
  return (
    <svg {...common}>
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="2.5"
      />
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeDasharray={`${pct * len} ${len}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

export function useNodeLabel() {
  const t = useTranslations("learnHub.node");
  return (v: NodeView, prereq: string, depth: ModuleSummary["depth"]): string => {
    if (!v.canStart) return t("locked", { prereq });
    if (depth === "coming") return t("coming");
    if (v.state === "mastered") return t("mastered");
    if (v.state === "fading") return t("fading");
    return t("learning", { pct: Math.round((v.mastery ?? 0) * 100) });
  };
}

export function SkillTree({
  modules,
  nodeStates,
  masteries,
}: {
  modules: ModuleSummary[];
  nodeStates: NodeStates;
  masteries: Record<string, number>;
}) {
  const t = useTranslations("learnHub.tree");
  const label = useNodeLabel();
  const short = new Map(modules.map((m) => [m.nodeId, m.short] as const));
  return (
    <section className="md-stack" aria-labelledby="tree-title">
      <h2 id="tree-title" className="md-h2">
        {t("title")}
      </h2>
      {BRANCHES.map((b) => {
        const nodes = modules.filter((m) => m.branch === b && m.inTree);
        if (nodes.length === 0) return null;
        return (
          <div key={b} className="md-stack">
            <h3 className="md-h3" id={`branch-${b}`}>
              {t(b)}
            </h3>
            <ol className="ml-list" aria-labelledby={`branch-${b}`}>
              {nodes.map((m) => {
                const v = nodeView(m.nodeId, nodeStates, masteries);
                const prereq = m.follows.map((f) => short.get(f) ?? f).join(" + ");
                const text = label(v, prereq, m.depth);
                return (
                  <li key={m.nodeId}>
                    <Link
                      href={`/learn/skill/${m.nodeId}`}
                      className="ml-node"
                      data-state={v.canStart ? v.state : "locked"}
                      data-testid={`node-${m.nodeId}`}
                    >
                      <span className="ml-node__glyph">
                        <NodeGlyph v={v} />
                      </span>
                      <span className="ml-node__text">
                        <span className="font-semibold">
                          {m.id} · {m.short}
                          {m.tenants ? ` · ${t("jkPack")}` : ""}
                        </span>
                        <span
                          className={v.state === "fading" ? "ml-chip ml-chip--warn" : "ml-small"}
                        >
                          {text}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </section>
  );
}
