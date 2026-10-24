"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { SkeletonText } from "@margdarshak/ui/components/skeleton";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

/** Screen states of the study flow (UI_SPEC_LEARN_GAMES §1.5): loading, error, offline. */

export function useOnline(): boolean {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener("online", l);
      window.addEventListener("offline", l);
      return () => {
        window.removeEventListener("online", l);
        window.removeEventListener("offline", l);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

export function StudyLoading({ label }: { label?: string }) {
  const t = useTranslations("study");
  return (
    <div className="st-state" aria-busy="true" data-testid="study-loading">
      <span className="md-sr-only" role="status">
        {label ?? t("states.loading")}
      </span>
      <SkeletonText lines={3} />
    </div>
  );
}

export function StudyError({ onRetry, line }: { onRetry?: () => void; line?: string }) {
  const t = useTranslations("study");
  return (
    <div className="st-state" data-testid="study-error">
      <Banner
        tone="caution"
        title={line ?? t("states.errorTitle")}
        action={
          onRetry ? (
            <Button variant="secondary" onPress={onRetry}>
              {t("states.retry")}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

export function StudyOfflineNote({ force = false }: { force?: boolean }) {
  const t = useTranslations("study");
  const online = useOnline();
  if (online && !force) return null;
  return (
    <div data-testid="study-offline">
      <Banner tone="offline" title={t("states.offlineTitle")}>
        {t("states.offlineBody")}
      </Banner>
    </div>
  );
}
