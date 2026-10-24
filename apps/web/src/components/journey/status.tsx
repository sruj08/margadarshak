"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { notify } from "@margdarshak/ui/components/toast";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "@/i18n/navigation";
import { flushPending } from "@/lib/case/draft";
import { sarathiStatus } from "@/lib/journey/api";

/** navigator.onLine as a hook (SSR assumes online, so the server HTML never shows the banner). */
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

/** True after the first client render (for device-only state that must not flash on SSR). */
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/**
 * Offline banner (ST-02) + replay of pending drafts when the phone is back online (ST-03).
 */
export function OfflineBanner() {
  const t = useTranslations("journey");
  const online = useOnline();
  useEffect(() => {
    if (!online) return;
    void flushPending().then((n) => {
      if (n > 0) notify(t("backOnline", { n }), { tone: "success" });
    });
  }, [online, t]);
  if (online) return null;
  return (
    <Banner tone="offline" title={t("offlineTitle")}>
      {t("offlineBody")}
    </Banner>
  );
}

/**
 * Sarathi outage (EC-11, ST-04): shown on hand-off screens when the adapter health says Sarathi is
 * down. Answers stay saved here; "Ping me" is an opt-in that is not built until reminders ship.
 */
export function SarathiStatusBanner({ onStatus }: { onStatus?: (down: boolean) => void }) {
  const t = useTranslations("journey");
  const [down, setDown] = useState(false);
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    const forced =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("sarathi") === "down";
    const s = forced ? "down" : await sarathiStatus();
    const isDown = s === "down";
    setDown(isDown);
    onStatus?.(isDown);
    setChecking(false);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: check once on mount
  useEffect(() => {
    void check();
  }, []);
  if (!down) return null;
  return (
    <Banner
      tone="caution"
      title={t("sarathiDownTitle")}
      action={
        <Button variant="secondary" isPending={checking} onPress={() => void check()}>
          {t("retry")}
        </Button>
      }
    >
      {t("sarathiDownBody")}
    </Banner>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mj-back">
      <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
      <span>{children}</span>
    </Link>
  );
}
