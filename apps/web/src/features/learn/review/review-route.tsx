"use client";

import { useSearchParams } from "next/navigation";
import { isLlTopic, type LlTopicId } from "../content/bank-types";
import { ReviewSession } from "./review-session";

/** Reads `?topic=LL1` on the client so the review page stays static (and works offline). */
export function ReviewRoute({ conceptCounts }: { conceptCounts: Record<LlTopicId, number> }) {
  const raw = useSearchParams().get("topic") ?? "";
  return <ReviewSession conceptCounts={conceptCounts} topic={isLlTopic(raw) ? raw : null} />;
}
