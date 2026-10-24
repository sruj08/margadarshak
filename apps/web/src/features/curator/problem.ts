"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { CuratorApiError, CuratorOffline } from "./api";

const KNOWN = [
  "CLIP_INVALID_TRANSITION",
  "RATING_ALREADY_SUBMITTED",
  "ADJUDICATOR_IS_RATER",
  "BLUR_AUDIT_FAILED",
  "PROHIBITED_FIELD",
  "VALIDATION_FAILED",
  "FORBIDDEN",
  "UNAUTHENTICATED",
] as const;
type Known = (typeof KNOWN)[number];

/** A refusal from the API (or the mock store) as one plain sentence in the UI language. */
export function useProblemText(): (e: unknown) => string {
  const t = useTranslations("curator");
  return useCallback(
    (e: unknown) => {
      if (e instanceof CuratorOffline) return t("states.offlineBody");
      if (e instanceof CuratorApiError) {
        const code = e.code as Known | undefined;
        if (code && (KNOWN as readonly string[]).includes(code)) return t(`problem.${code}`);
        if (e.status === 403) return t("problem.FORBIDDEN");
        if (e.status === 401) return t("problem.UNAUTHENTICATED");
        return t("problem.other", { status: e.status });
      }
      return t("states.errorTitle");
    },
    [t],
  );
}
