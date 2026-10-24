"use client";

import type { ProvOut } from "@margdarshak/rules";
import { Chip } from "@margdarshak/ui/components/chip";
import { SourceChip } from "@margdarshak/ui/components/source-chip";
import { formatInr, formatIsoDate } from "@margdarshak/ui/lib/format";
import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { shortSource } from "@/lib/fees/trust-line";

/** A short chip label: the source name, cut at a word after ~28 characters (full title in the popover). */
export function chipLabel(title: string): string {
  const s = shortSource(title || "Rule pack");
  if (s.length <= 28) return s;
  const cut = s.slice(0, 28);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 16)).trimEnd()}…`;
}

/** "Checked / Likely / Verify at your RTO" from a provenance confidence (ConfidenceBadge). */
export function useConfidenceWord() {
  const t = useTranslations("source");
  return useCallback(
    (c: string) =>
      c === "high"
        ? t("confidenceHigh")
        : c === "medium"
          ? t("confidenceMedium")
          : t("confidenceLow"),
    [t],
  );
}

export function useFmt() {
  const locale = useLocale();
  return {
    locale,
    inr: (paise: number) => formatInr(paise, locale),
    date: (iso: string, style: "short" | "long" = "short") => formatIsoDate(iso, locale, style),
  };
}

/**
 * SourceChip for a rule-pack provenance (P6 honest by construction): short source, the date it was
 * checked, confidence, and a link. Unverified rows also get the "Verify at your RTO" chip.
 */
export function RuleSource({
  prov,
  verifyAtRto,
  detail,
}: {
  prov: ProvOut;
  verifyAtRto?: boolean;
  detail?: string;
}) {
  const t = useTranslations("source");
  const ta = useTranslations("a11y");
  const tj = useTranslations("journey");
  const word = useConfidenceWord();
  const { date } = useFmt();
  const checked = prov.checked_on
    ? t("checked", { date: date(prov.checked_on) })
    : tj("notChecked");
  const showVerify = verifyAtRto ?? (!prov.verified || prov.confidence === "low");
  return (
    <span className="mj-chips">
      <SourceChip
        source={chipLabel(prov.source_title)}
        checked={checked}
        sourceTitle={prov.source_title}
        {...(prov.source_url ? { sourceUrl: prov.source_url } : {})}
        confidence={word(prov.confidence)}
        {...(detail ? { detail } : {})}
        labels={{
          heading: t("heading"),
          confidenceLabel: t("confidence"),
          openSource: t("openSource"),
          newTab: ta("externalNewTab"),
        }}
      />
      {showVerify ? <VerifyChip /> : null}
    </span>
  );
}

export function VerifyChip() {
  const t = useTranslations("source");
  return (
    <Chip tone="caution" className="mj-verify">
      {t("confidenceLow")}
    </Chip>
  );
}
