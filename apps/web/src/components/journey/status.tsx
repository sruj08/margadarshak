"use client";

import "@/features/flow/flow.css";
import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { notify } from "@margdarshak/ui/components/toast";
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "@/i18n/navigation";
import { flushPending } from "@/lib/case/draft";
import {
  DEMO_TENANT,
  readCachedWatchdogReport,
  type SarathiWatchdogReport,
  sarathiStatus,
  triggerSarathiWatchdog,
} from "@/lib/journey/api";

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
 * down. Answers stay saved here; includes the 1-click n8n W15 Watchdog control bar for judges.
 */
export function SarathiStatusBanner({ onStatus }: { onStatus?: (down: boolean) => void }) {
  const t = useTranslations("journey");
  const [down, setDown] = useState(false);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<SarathiWatchdogReport | null>(null);

  const check = async () => {
    setChecking(true);
    const forced =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("sarathi") === "down";
    const s = forced ? "down" : await sarathiStatus();
    const isDown = s === "down";
    setDown(isDown);
    setReport(readCachedWatchdogReport());
    onStatus?.(isDown);
    setChecking(false);
  };

  const runWatchdog = async (mode: "simulate_down" | "restore" | "probe") => {
    setChecking(true);
    const r = await triggerSarathiWatchdog(mode);
    const isDown = r.status === "down";
    setReport(r);
    setDown(isDown);
    onStatus?.(isDown);
    setChecking(false);
    notify(isDown ? t("watchdogToastDown") : t("watchdogToastUp"), {
      tone: isDown ? "info" : "success",
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: check once on mount
  useEffect(() => {
    void check();
  }, []);

  return (
    <div className="fl-grid" style={{ gap: "14px" }}>
      {DEMO_TENANT ? (
        <section
          className="fl-shell"
          aria-label={t("watchdogLabel")}
          data-testid="n8n-watchdog-bar"
        >
          <div className={`fl-shell__bar ${down ? "fl-shell__bar--outage" : "fl-shell__bar--pay"}`}>
            <span className="fl-shell__ident">
              <span className="fl-emblem" aria-hidden="true">
                {down ? <AlertTriangle size={20} /> : <Activity size={20} />}
              </span>
              <span className="fl-shell__brand">
                <strong>{t("watchdogBadge")}</strong>
                <span data-testid="n8n-watchdog-status">
                  {down ? t("watchdogStateDown") : t("watchdogStateUp")}
                </span>
              </span>
            </span>
            <span className="fl-shell__lock">
              <CheckCircle2 aria-hidden="true" />
              {t("watchdogChip")}
            </span>
          </div>

          <div className="fl-shell__body" style={{ gap: "14px", padding: "18px 20px" }}>
            <p className="mj-caption" style={{ margin: 0, lineHeight: 1.5 }}>
              {down ? t("watchdogHintDown") : t("watchdogHintUp")}
            </p>

            {down && report?.endpoints && report.endpoints.length > 0 ? (
              <dl className="fl-kv">
                {report.endpoints.map((ep) => (
                  <div key={ep.name} style={{ padding: "8px 0", alignItems: "center" }}>
                    <dt className="mj-num" style={{ fontSize: "0.8125rem" }}>
                      {ep.name}
                    </dt>
                    <dd>
                      <span className="fl-stamp fl-stamp--warn">
                        HTTP {ep.http_status} · {ep.latency_ms} ms
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                gap: "10px",
              }}
            >
              {!down ? (
                <Button
                  variant="primary"
                  size="md"
                  fullWidth
                  isPending={checking}
                  onPress={() => void runWatchdog("simulate_down")}
                  data-testid="n8n-simulate-outage"
                >
                  <AlertTriangle size={16} aria-hidden="true" />
                  {t("watchdogSimulateBtn")}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  fullWidth
                  isPending={checking}
                  onPress={() => void runWatchdog("restore")}
                  data-testid="n8n-restore-portal"
                >
                  <CheckCircle2 size={16} aria-hidden="true" />
                  {t("watchdogRestoreBtn")}
                </Button>
              )}
              <Button
                variant="secondary"
                size="md"
                fullWidth
                isPending={checking}
                onPress={() => void runWatchdog("probe")}
                data-testid="n8n-probe-live"
              >
                <RefreshCw size={15} aria-hidden="true" />
                {t("watchdogProbeBtn")}
              </Button>
            </div>
          </div>
        </section>
      ) : null}
      {down ? (
        <Banner
          tone="caution"
          title={t("sarathiDownTitle")}
          action={
            <Button
              variant="secondary"
              isPending={checking}
              onPress={() => void runWatchdog("restore")}
            >
              {t("retry")}
            </Button>
          }
        >
          {t("sarathiDownBody")}
        </Banner>
      ) : null}
    </div>
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
