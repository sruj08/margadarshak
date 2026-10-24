import { SourceChip } from "@margdarshak/ui/components/source-chip";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { formatInr, formatIsoDate } from "@margdarshak/ui/lib/format";
import { getLocale, getTranslations } from "next-intl/server";
import { getTrustFees } from "@/lib/fees/pack";

/**
 * TrustLine (C-03, MC-010, MD-024). Both amounts are computed from rulepacks/fees.json at build time
 * and formatted by Intl in en-IN / hi-IN (₹ and lakh grouping; plain `en` would group as 135,000);
 * the message file holds only placeholders. If the pack
 * cannot be read, the numbers are hidden rather than guessed.
 */
export async function TrustLine() {
  const t = await getTranslations();
  const fees = getTrustFees();

  if (!fees) {
    return (
      <div className="md-trust" data-testid="trust-line">
        <StatusGlyph kind="info" size={22} className="md-trust__glyph" />
        <p className="md-trust__text">{t("trust.unavailable")}</p>
      </div>
    );
  }

  const locale = await getLocale();
  const checkedDate = formatIsoDate(fees.source.checkedOn, locale, "short");
  const confidence =
    fees.source.confidence === "high"
      ? t("source.confidenceHigh")
      : fees.source.confidence === "medium"
        ? t("source.confidenceMedium")
        : t("source.confidenceLow");

  return (
    <div className="md-trust" data-testid="trust-line">
      <StatusGlyph kind="info" size={22} className="md-trust__glyph" />
      <div className="md-trust__body">
        <p className="md-trust__text">
          {t.rich("trust.line", {
            fee_one_class: formatInr(fees.oneClassPaise, locale),
            fee_card: formatInr(fees.cardPaise, locale),
            num: (chunks) => <span className="md-num md-trust__num">{chunks}</span>,
          })}
        </p>
        <SourceChip
          source={fees.source.short}
          checked={t("source.checked", { date: checkedDate })}
          sourceTitle={fees.source.title}
          {...(fees.source.url ? { sourceUrl: fees.source.url } : {})}
          confidence={confidence}
          detail={t("source.trustDetail")}
          labels={{
            heading: t("source.heading"),
            confidenceLabel: t("source.confidence"),
            openSource: t("source.openSource"),
            newTab: t("a11y.externalNewTab"),
          }}
        />
      </div>
    </div>
  );
}
