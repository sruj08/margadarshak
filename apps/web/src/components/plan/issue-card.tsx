"use client";

import type { Issue } from "@margdarshak/rules";
import { Button } from "@margdarshak/ui/components/button";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { useTranslations } from "next-intl";
import { RuleSource, useFmt } from "@/components/journey/rule-source";
import { useRuleText } from "@/components/journey/rule-text";
import { ruleRow } from "@/lib/journey/rules";

/**
 * BlockerRow (MD-107, F-04, SCR-020): glyph + word + colour edge, plain text, "how to fix", the
 * source and confidence, and an optional "I've fixed this" that re-evaluates the plan. Calm by
 * design: no red fills, no alarm words. Severity: blocker = blocks this path, warning = changes
 * the path, notice = keep in mind.
 */
export interface IssueAction {
  label: string;
  run: () => void;
}

export function IssueCard({
  issue,
  action,
  headingLevel = 3,
  fixed = false,
}: {
  issue: Issue;
  action?: IssueAction | null;
  headingLevel?: 2 | 3 | 4;
  fixed?: boolean;
}) {
  const t = useTranslations("issue");
  const rt = useRuleText();
  const { date } = useFmt();
  const row = ruleRow(issue.rule_id);
  const values = issue.due_on ? { date: date(issue.due_on, "long") } : undefined;
  const text = rt(issue.text_key, row?.text?.en, values);
  const fix = issue.fix_key ? rt(issue.fix_key, undefined, values) : null;
  const sev = fixed
    ? "fixed"
    : issue.severity === "blocker"
      ? "blocker"
      : issue.severity === "warning"
        ? "warning"
        : "notice";
  const glyph = fixed
    ? "done"
    : sev === "blocker"
      ? "danger"
      : sev === "warning"
        ? "caution"
        : "info";
  const H = `h${headingLevel}` as "h3";
  return (
    <article className={`mj-issue mj-issue--${sev}`} data-rule={issue.rule_id} data-testid="issue">
      <StatusGlyph kind={glyph} size={22} className="mj-issue__glyph" />
      <div className="mj-issue__body">
        <H className="mj-issue__sev">
          <span className="md-sr-only">{t("severityPrefix")} </span>
          {t(`sev.${sev}`)}
        </H>
        <p className="mj-issue__text">{text}</p>
        {fix && fix !== issue.fix_key ? (
          <div className="mj-issue__fix">
            <strong>{t("howToFix")}</strong>
            {fix}
          </div>
        ) : null}
        <div className="mj-issue__foot">
          <RuleSource prov={issue.provenance} verifyAtRto={issue.verify_at_rto} />
          {action && !fixed ? (
            <Button variant="tertiary" onPress={action.run}>
              {action.label}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
