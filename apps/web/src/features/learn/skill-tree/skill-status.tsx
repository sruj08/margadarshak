"use client";

import type { LlTopicId } from "../content/bank-types";
import type { Depth } from "../content/curriculum";
import { nodeView } from "../nodes";
import { useLearner } from "../use-learner";
import { NodeGlyph, useNodeLabel } from "./skill-tree";

/** The node's state line on the skill page (glyph + words + mastery bar). */
export function SkillStatus({
  nodeId,
  depth,
  conceptCounts,
}: {
  nodeId: string;
  depth: Depth;
  conceptCounts: Record<LlTopicId, number>;
}) {
  const { state } = useLearner(conceptCounts);
  const label = useNodeLabel();
  if (!state)
    return (
      <p className="ml-small" aria-busy="true">
        …
      </p>
    );
  const v = nodeView(nodeId, state.nodeStates, state.masteries);
  return (
    <div className="ml-row" data-testid="skill-status" data-state={v.state}>
      <span className="ml-node__glyph">
        <NodeGlyph v={v} />
      </span>
      <span>{label(v, "M1 + LL1", depth)}</span>
      {v.mastery !== null ? (
        <span className="ml-bar" style={{ width: 120 }} aria-hidden="true">
          <span style={{ width: `${Math.round(v.mastery * 100)}%` }} />
        </span>
      ) : null}
    </div>
  );
}
