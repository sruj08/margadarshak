"use client";

import type { NodeStates } from "@margdarshak/gamification";
import { useCallback, useEffect, useState } from "react";
import { getAchievements, getReadiness, type ReadinessView } from "./api";
import type { Achievement, Source } from "./api-types";
import type { LlTopicId } from "./content/bank-types";
import { ratedAnswers } from "./learning";
import { deviceNodeStates, lessonsDone, refreshNodeHistory, serverNodeStates } from "./nodes";
import { type LogEntry, reviewStore } from "./offline/review-store";
import { bindOutbox } from "./offline/sync";
import { type LearnerProfile, learnerProfile } from "./profile";

/**
 * Everything the hub, readiness and Me screens read about the learner, from the server when it
 * answers, else from this phone (each part carries its `source`).
 */
export interface LearnerState {
  profile: LearnerProfile;
  log: LogEntry[];
  readiness: ReadinessView;
  nodeStates: NodeStates;
  /** LL mastery per node ("SK-LL1" → 0.62), for the "Learning · 62%" labels. */
  masteries: Record<string, number>;
  achievement: Achievement;
  achievementSource: Source;
}

export function useLearner(conceptCounts: Record<LlTopicId, number>) {
  const [state, setState] = useState<LearnerState | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const profile = learnerProfile();
      const now = Date.now();
      const log = await reviewStore().log();
      const hist = refreshNodeHistory(log, now, conceptCounts);
      const readiness = await getReadiness(now, conceptCounts, profile);
      const nodeStates =
        readiness.source === "server" && readiness.readiness.road_readiness?.nodes
          ? serverNodeStates(readiness.readiness.road_readiness.nodes)
          : deviceNodeStates(hist, lessonsDone());
      const masteries: Record<string, number> = {};
      for (const t of readiness.readiness.topics) masteries[`SK-${t.topic_id}`] = t.mastery;
      const ach = await getAchievements(now, nodeStates, ratedAnswers(log), profile);
      setState({
        profile,
        log,
        readiness,
        nodeStates,
        masteries,
        achievement: ach.data,
        achievementSource: ach.source,
      });
    } catch {
      setError(true);
    }
  }, [conceptCounts]);

  useEffect(() => {
    bindOutbox();
    void load();
  }, [load]);

  return { state, error, reload: load };
}
