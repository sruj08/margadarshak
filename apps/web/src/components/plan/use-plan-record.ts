"use client";

import { useEffect, useState } from "react";
import { computePlan } from "@/lib/journey/api";
import { decodeShare, type PlanAnswers, type PlanRecord } from "@/lib/journey/plan-model";
import { getPlan, savePlan, usePlan } from "@/lib/journey/plan-store";
import { isStateCode } from "@/lib/journey/rules";

/**
 * Reads the plan for the current URL: `?id=` (a plan on this phone) or `?s=` (a shared link, which
 * carries only an age band, vehicles and state; the plan is recomputed here). Returns
 * "loading" during hydration so the card never flashes an empty state.
 */
export function usePlanFromUrl(): {
  record: PlanRecord | null;
  status: "loading" | "ready" | "missing";
} {
  const [id, setId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const record = usePlan(id);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pid = params.get("id");
    if (pid && getPlan(pid)) {
      setId(pid);
      setStatus("ready");
      return;
    }
    const shared = params.get("s");
    const payload = shared ? decodeShare(shared) : null;
    if (payload && isStateCode(payload.s)) {
      const answers: PlanAnswers = {
        age: { kind: "band", band: payload.b },
        vehicles: payload.v,
        state: payload.s,
        aadhaar: payload.a,
      };
      void computePlan(answers)
        .then((rec) => {
          savePlan(rec);
          setId(rec.id);
          const url = new URL(window.location.href);
          url.searchParams.delete("s");
          url.searchParams.set("id", rec.id);
          window.history.replaceState(null, "", url);
          setStatus("ready");
        })
        .catch(() => setStatus("missing"));
      return;
    }
    setStatus("missing");
  }, []);

  return { record, status: record ? "ready" : status === "ready" ? "loading" : status };
}
