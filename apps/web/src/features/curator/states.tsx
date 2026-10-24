"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { SkeletonText } from "@margdarshak/ui/components/skeleton";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { Link } from "@/i18n/navigation";

/**
 * The five screen states of the clip admin (UI_SPEC_LEARN_GAMES §1.5, §12): loading, empty, error,
 * offline and success (the screen itself).
 */

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

export function CuratorLoading({ label }: { label?: string }) {
  const t = useTranslations("curator");
  return (
    <div className="cu-state" aria-busy="true" data-testid="curator-loading">
      <span className="md-sr-only" role="status">
        {label ?? t("states.loading")}
      </span>
      <SkeletonText lines={4} />
    </div>
  );
}

export function CuratorError({ onRetry, line }: { onRetry?: () => void; line?: string }) {
  const t = useTranslations("curator");
  return (
    <div className="cu-state" data-testid="curator-error">
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

export function CuratorEmpty({
  title,
  line,
  href,
  cta,
}: {
  title: string;
  line?: string;
  href: string;
  cta: string;
}) {
  return (
    <div data-testid="curator-empty">
      <EmptyState
        title={title}
        {...(line ? { line } : {})}
        action={
          <Link href={href} className={buttonClassName({ variant: "primary", size: "lg" })}>
            {cta}
          </Link>
        }
      />
    </div>
  );
}

export function CuratorOfflineState() {
  const t = useTranslations("curator");
  return (
    <div data-testid="curator-offline">
      <Banner tone="offline" title={t("states.offlineTitle")}>
        {t("states.offlineBody")}
      </Banner>
    </div>
  );
}

/** Offline banner at the top of a screen; nothing online (and nothing on the server). */
export function CuratorOfflineNote() {
  const online = useOnline();
  return online ? null : <CuratorOfflineState />;
}

/** "Mock data" label whenever a response came from the mock store. */
export function MockSourceNote({ source }: { source: "server" | "mock" | null }) {
  const t = useTranslations("curator");
  if (source !== "mock") return null;
  return (
    <p className="cu-mocknote" role="note" data-testid="curator-mock-source">
      {t("mock.source")}
    </p>
  );
}
