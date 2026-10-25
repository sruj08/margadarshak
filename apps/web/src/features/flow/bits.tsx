"use client";

import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { FastForward, FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Link } from "@/i18n/navigation";
import { API_MODE, DEMO_TENANT } from "@/lib/journey/api";
import { refFor } from "./flow-case";

/** "Simulated" ribbon on every third-party stand-in (D-19 honesty, R-03). */
export function SimRibbon({ text }: { text?: string }) {
  const t = useTranslations("flow");
  return (
    <p className="fl-ribbon" role="note">
      <FlaskConical aria-hidden="true" />
      <span>{text ?? t("simulated")}</span>
    </p>
  );
}

/** Decorative QR-like matrix for slips and certificates (no real payload; aria-labelled). */
export function PseudoQr({ seed, label }: { seed: string; label: string }) {
  const cells = useMemo(() => {
    const n = 21;
    const bits = refFor(seed, n * n);
    const finder = (x: number, y: number) => {
      const inBox = (ox: number, oy: number) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
      for (const [ox, oy] of [
        [0, 0],
        [n - 7, 0],
        [0, n - 7],
      ] as const) {
        if (inBox(ox, oy)) {
          const dx = x - ox;
          const dy = y - oy;
          const ring = dx === 0 || dy === 0 || dx === 6 || dy === 6;
          const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
          return ring || core ? 1 : 0;
        }
      }
      return -1;
    };
    const out: Array<[number, number]> = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const f = finder(x, y);
        if (f === 1 || (f === -1 && Number(bits[y * n + x]) % 2 === 0)) out.push([x, y]);
      }
    return out;
  }, [seed]);
  return (
    <svg
      className="fl-qr"
      viewBox="0 0 21 21"
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#111" />
      ))}
    </svg>
  );
}

/** Demo-clock control: only in the demo tenant on the device API (never on a real server). */
export function DemoSkip({
  days,
  onSkip,
  label,
}: {
  days: number;
  onSkip: () => void | Promise<void>;
  label?: string;
}) {
  const t = useTranslations("flow");
  if (!DEMO_TENANT || API_MODE !== "mock" || days <= 0) return null;
  return (
    <section className="mj-card mj-card--well fl-noprint" aria-label={t("demoOnly")}>
      <p className="mj-caption">{t("demoOnly")}</p>
      <Button variant="secondary" size="lg" onPress={() => void onSkip()}>
        <FastForward aria-hidden="true" />
        {label ?? t("skipDays", { n: days })}
      </Button>
    </section>
  );
}

export function NoFlowCase() {
  const t = useTranslations("flow");
  return (
    <EmptyState
      as="h1"
      title={t("noCase")}
      action={
        <Link href="/plan" className={buttonClassName({ variant: "primary", size: "lg" })}>
          {t("makePlan")}
        </Link>
      }
    />
  );
}
