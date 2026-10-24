"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

/**
 * The shared screen states (UI_SPEC_LEARN_GAMES §1.5): loading (static skeleton, aria-busy),
 * error (one retry, "your progress is saved"), offline (banner; learning keeps working) and the
 * family-mode chip. Empty and success are per screen.
 */

export function LoadingState({ rows = 3, label }: { rows?: number; label?: string }) {
  const t = useTranslations("learnHub.state");
  return (
    <div className="md-stack" aria-busy="true" aria-label={label ?? t("loading")} role="status">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows never reorder
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("learnHub.state");
  return (
    <Banner
      tone="caution"
      title={t("error")}
      action={
        <Button variant="secondary" onPress={onRetry}>
          {t("retry")}
        </Button>
      }
    />
  );
}

function subscribe(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** True while the browser reports no network. */
export function useOffline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine === false,
    () => false,
  );
}

export function OfflineBanner() {
  const t = useTranslations("learnHub.state");
  const offline = useOffline();
  if (!offline) return null;
  return <Banner tone="offline" title={t("offline")} />;
}

export function FamilyChip({ holder }: { holder: string | null }) {
  const t = useTranslations("learnHub.state");
  return (
    <p className="ml-chip" data-testid="family-chip">
      {t("family", { holder: holder ?? t("parent") })}
    </p>
  );
}

/** "On-device estimate" label for numbers this phone computed while the server was not reachable. */
export function DeviceNote({ kind }: { kind: "estimate" | "saved" }) {
  const t = useTranslations("learnHub.state");
  return (
    <p className="ml-small" data-testid="device-note">
      {kind === "estimate" ? t("deviceEstimate") : t("savedHere")}
    </p>
  );
}
