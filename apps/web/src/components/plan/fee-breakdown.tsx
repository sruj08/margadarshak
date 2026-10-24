"use client";

import type { FeeQuote } from "@margdarshak/rules";
import { useTranslations } from "next-intl";
import { RuleSource, useFmt } from "@/components/journey/rule-source";
import { useRuleText } from "@/components/journey/rule-text";
import { feeItem } from "@/lib/journey/rules";

/**
 * FeeBreakdown (SCR-016, SCR-039, D-06): every rupee per line, from fees.json in integer paise,
 * formatted by Intl. Lines for several classes collapse into "LL fee × 2". State items that are
 * only reported (not in the total) are listed separately with their confidence.
 */
export interface FeeRow {
  id: string;
  label: string;
  qty: number;
  unit: number;
  amount: number;
  stage: string;
}

export function groupFeeLines(q: FeeQuote, label: (key: string) => string): FeeRow[] {
  const rows = new Map<string, FeeRow>();
  for (const l of q.lines) {
    const r = rows.get(l.fee_id);
    if (r) {
      r.qty += l.quantity;
      r.amount += l.amount_paise;
    } else {
      rows.set(l.fee_id, {
        id: l.fee_id,
        label: label(l.label_key),
        qty: l.quantity,
        unit: l.unit_paise,
        amount: l.amount_paise,
        stage: l.stage,
      });
    }
  }
  return [...rows.values()];
}

export function FeeBreakdown({ quote, stage }: { quote: FeeQuote; stage?: "LL" | "DL" }) {
  const t = useTranslations("fees");
  const rt = useRuleText();
  const { inr } = useFmt();
  const rows = groupFeeLines(quote, (k) => rt(k)).filter((r) => !stage || r.stage === stage);
  const total = stage ? rows.reduce((n, r) => n + r.amount, 0) : quote.total_paise;
  const reported = quote.state_items.filter((s) => !s.included_in_total);
  return (
    <div className="mj-screen" style={{ gap: 14 }}>
      <dl className="mj-fees" data-testid="fee-lines">
        {rows.map((r) => {
          const note = feeItem(r.id)?.noteKey;
          return (
            <div key={r.id}>
              <dt>
                {r.label}
                {r.qty > 1 ? (
                  <small>
                    {inr(r.unit)} × {r.qty}
                    <span className="md-sr-only"> {t("forClasses", { n: r.qty })}</span>
                  </small>
                ) : null}
                {note ? <small>{rt(note)}</small> : null}
              </dt>
              <dd>{inr(r.amount)}</dd>
            </div>
          );
        })}
        <div className="mj-fees__total">
          <dt>{stage === "LL" ? t("nowTotal") : t("total")}</dt>
          <dd data-testid="fee-total">{inr(total)}</dd>
        </div>
      </dl>
      {reported.length > 0 ? (
        <div className="mj-card mj-card--well">
          <p className="mj-card__title">{t("reportedTitle")}</p>
          {reported.map((s) => (
            <div key={s.fee_id} style={{ display: "grid", gap: 6 }}>
              <p>
                {rt(s.label_key)} · <span className="mj-num">{inr(s.amount_paise)}</span>
              </p>
              <RuleSource prov={s.provenance} />
            </div>
          ))}
        </div>
      ) : null}
      <p className="mj-muted">{t("stateExtra")}</p>
      <p>
        <strong>{t("more")}</strong>
      </p>
      <RuleSource prov={quote.provenance} detail={t("sourceDetail")} />
    </div>
  );
}
