"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { SkeletonText } from "@margdarshak/ui/components/skeleton";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { useOnline } from "./host/online";

/**
 * The five screen states every learn/games page shows (UI_SPEC_LEARN_GAMES §1.5): loading
 * (static skeleton), empty (one line, one action), error (one retry, "your progress is saved"),
 * offline (top banner) and success (the page itself).
 */
export function StateLoading({ label }: { label?: string }) {
  const t = useTranslations("games");
  return (
    <div className="mg-state" aria-busy="true" data-testid="state-loading">
      <span className="md-sr-only" role="status">
        {label ?? t("states.loading")}
      </span>
      <SkeletonText lines={4} />
    </div>
  );
}

export function StateError({ onRetry, line }: { onRetry?: () => void; line?: string }) {
  const t = useTranslations("games");
  return (
    <div className="mg-state" data-testid="state-error">
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

export function StateEmpty({
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
    <div data-testid="state-empty">
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

/** Offline banner; renders nothing online (and nothing on the server). */
export function OfflineNote({ children }: { children?: ReactNode }) {
  const t = useTranslations("games");
  const online = useOnline();
  if (online) return null;
  return (
    <div data-testid="state-offline">
      <Banner tone="offline" title={t("states.offlineTitle")}>
        {children ?? t("states.offlineBody")}
      </Banner>
    </div>
  );
}
