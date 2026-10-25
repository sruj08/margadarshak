"use client";

import { Disclosure } from "@heroui/react";
import type { Issue, Plan } from "@margdarshak/rules";
import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Chip } from "@margdarshak/ui/components/chip";
import { CountUp } from "@margdarshak/ui/components/count-up";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { ShinyText } from "@margdarshak/ui/components/shiny-text";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { SplitText } from "@margdarshak/ui/components/split-text";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { notify } from "@margdarshak/ui/components/toast";
import { ChevronRight, Share2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { RuleSource, useFmt, VerifyChip } from "@/components/journey/rule-source";
import { useRuleText } from "@/components/journey/rule-text";
import { BackLink, useOnline } from "@/components/journey/status";
import { CLASS_PICTURE, VehiclePictogram } from "@/components/journey/vehicle-pictogram";
import { Link, useRouter } from "@/i18n/navigation";
import { computePlan } from "@/lib/journey/api";
import { daysBetween, istToday } from "@/lib/journey/dates";
import { answersHash, fixFor, isDismissed, stopsApplication } from "@/lib/journey/fixes";
import {
  chosenPath,
  encodeShare,
  isApproximateAge,
  maxVisits,
  type PlanAnswers,
  type PlanRecord,
  toSharePayload,
} from "@/lib/journey/plan-model";
import { savePlan } from "@/lib/journey/plan-store";
import { classByCode, rulesCheckedOn } from "@/lib/journey/rules";
import { track } from "@/lib/journey/track";
import { recordScreen } from "@/lib/journey/trial-log";
import { FeeBreakdown } from "./fee-breakdown";
import { IssueCard } from "./issue-card";
import { ShareSheet } from "./share-sheet";
import { usePlanFromUrl } from "./use-plan-record";

/** Re-runs a plan with changed answers, keeping its ID (so links and the case stay attached). */
export async function reevaluate(
  rec: PlanRecord,
  patch: Partial<PlanAnswers>,
): Promise<PlanRecord> {
  const next = await computePlan({ ...rec.answers, ...patch });
  const updated: PlanRecord = {
    ...next,
    id: rec.id,
    ...(rec.dismissed ? { dismissed: rec.dismissed } : {}),
  };
  savePlan(updated);
  return updated;
}

export function useIssueActions(rec: PlanRecord | null) {
  const t = useTranslations("issue");
  const tj = useTranslations("journey");
  const router = useRouter();
  return (issue: Issue) => {
    if (!rec) return null;
    const fix = fixFor(issue);
    if (!fix) return null;
    return {
      label: t(fix.labelKey as "fixedGeneric"),
      run: () => {
        if (fix.kind === "dob") {
          router.push(`/plan?from=${encodeURIComponent(rec.id)}&step=1`);
          return;
        }
        if (fix.kind === "dismiss") {
          savePlan({
            ...rec,
            dismissed: { ...(rec.dismissed ?? {}), [issue.rule_id]: answersHash(rec.answers) },
          });
          notify(t("markedSorted"), { tone: "success" });
          return;
        }
        const before = maxVisits(rec.plan, rec.answers);
        void reevaluate(rec, fix.patch).then((n) => {
          const after = maxVisits(n.plan, n.answers);
          notify(t("rechecked"), {
            tone: "success",
            ...(before !== after ? { description: tj("visitsDiff", { before, after }) } : {}),
          });
        });
      },
    };
  };
}

export function classNames(plan: Plan, rt: ReturnType<typeof useRuleText>): string {
  return plan.requested_classes
    .map((code) => {
      const c = plan.classes.find((x) => x.class_code === code);
      return rt(c?.name_key, classByCode(code)?.name.en);
    })
    .join(" + ");
}

export function PlanCardScreen() {
  const { record, status } = usePlanFromUrl();
  const t = useTranslations("planCard");
  if (status === "loading") {
    return (
      <div className="mj-screen" aria-busy="true" data-screen="SCR-014">
        <Skeleton className="mj-skel-title" />
        <div className="mj-card">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="mj-skel-row" />
          ))}
        </div>
      </div>
    );
  }
  if (!record) {
    return (
      <div className="mj-screen" data-screen="SCR-014">
        <EmptyState
          as="h1"
          title={t("missingTitle")}
          line={t("missingLine")}
          action={
            <Link href="/plan" className={buttonClassName({ variant: "primary", size: "lg" })}>
              {t("newPlan")}
            </Link>
          }
        />
      </div>
    );
  }
  return <PlanCard record={record} />;
}

function PlanCard({ record }: { record: PlanRecord }) {
  const t = useTranslations("planCard");
  const tFlow = useTranslations("flow.wizard");
  const tc = useTranslations("common");
  const tf = useTranslations("fees");
  const ti = useTranslations("issue");
  const rt = useRuleText();
  const locale = useLocale();
  const { inr, date } = useFmt();
  const online = useOnline();
  const [feesOpen, setFeesOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const issueAction = useIssueActions(record);
  const { plan, answers } = record;

  // biome-ignore lint/correctness/useExhaustiveDependencies: one plan_viewed per plan record
  useEffect(() => {
    recordScreen("plan.card");
    // Counts only (API-63); nothing about a 16-17-year-old's plan (D-13 revised).
    if (!plan.family_mode_required)
      track("plan_viewed", {
        classes_count: plan.classes.length,
        blockers_count: plan.blockers.length + plan.warnings.length,
        rulepack_version: plan.rule_pack.version,
      });
  }, [record.id]);

  const expired = daysBetween(record.createdAt.slice(0, 10), istToday()) > 30;
  const visible = (i: Issue) => !isDismissed(record.dismissed, i.rule_id, answers);
  const needsYou = [...plan.blockers, ...plan.warnings].filter(visible);
  const sorted = [...plan.blockers, ...plan.warnings].filter((i) => !visible(i));
  const notices = plan.notices;
  const eligible = plan.classes.filter((c) => c.eligible);
  const later = plan.classes.filter((c) => !c.eligible);
  const path = chosenPath(plan, answers);
  const visits = maxVisits(plan, answers);
  const minor = plan.family_mode_required;
  const stop = stopsApplication(plan.blockers, eligible.length === 0);
  const names = classNames(plan, rt);
  const checkedOn = rulesCheckedOn(plan.state);
  const earliest = plan.earliest_dates?.earliest_licence ?? null;
  const docs = plan.documents.filter((d) => d.required);
  const shareLink = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/${locale}/plan/card?s=${encodeShare(toSharePayload(answers, record.asOf))}`;
  }, [answers, locale, record.asOf]);

  if (expired) {
    return (
      <div className="mj-screen" data-screen="SCR-014">
        <EmptyState
          as="h1"
          title={t("expiredTitle")}
          line={t("expiredLine")}
          action={
            <Link href="/plan" className={buttonClassName({ variant: "primary", size: "lg" })}>
              {t("newPlan")}
            </Link>
          }
        />
      </div>
    );
  }

  const llFee = plan.fees?.ll_stage_paise ?? 0;
  const dlFee = (plan.fees?.total_paise ?? 0) - llFee;
  const stepFee = (key: string): string | null => {
    if (!plan.fees) return null;
    if (key === "ll.apply") return inr(llFee);
    if (key === "dl.issue") return inr(dlFee);
    return null;
  };

  return (
    <div className="mj-screen" data-screen="SCR-014" data-testid="plan-card">
      <div className="mj-toprow">
        <BackLink href={`/plan?from=${encodeURIComponent(record.id)}`}>{t("change")}</BackLink>
        <Button variant="ghost" onPress={() => setShareOpen(true)}>
          <Share2 aria-hidden="true" />
          {t("share")}
        </Button>
      </div>

      <header className="mj-head">
        <div className="mj-glow" aria-hidden="true" />
        <p className="mj-eyebrow">
          <ShinyText>
            {names} · {tc(`state.${plan.state}` as "state.JK")}
          </ShinyText>
        </p>
        <h1 className="mj-title">
          <SplitText text={t("h1")} delay={40} duration={0.55} splitType="words" />
        </h1>
        <div className="mj-chips">
          {record.source === "server" ? (
            <span data-testid="plan-saved">
              <Chip tone="success">{t("saved")}</Chip>
            </span>
          ) : (
            <span data-testid="computed-on-phone">
              <Chip tone="info">{t("computedOnPhone", { date: date(checkedOn) })}</Chip>
            </span>
          )}
          {isApproximateAge(answers.age) ? <Chip tone="neutral">{t("approxAge")}</Chip> : null}
        </div>
      </header>

      {minor ? (
        <Banner tone="info" title={t("familyTitle")}>
          {t("familyBody")}
        </Banner>
      ) : null}
      {!online ? (
        <Banner tone="offline" title={t("offlineTitle")}>
          {t("offlineBody")}
        </Banner>
      ) : null}

      <div className="mj-two">
        <div className="mj-screen">
          <section className="mj-card" aria-labelledby="pc-classes">
            <h2 id="pc-classes" className="mj-card__title">
              {eligible.length > 0 ? t("eligible") : t("noneEligible")}
            </h2>
            {plan.classes.map((c) => {
              const row = classByCode(c.class_code);
              return (
                <div
                  key={c.class_code}
                  className={`mj-class${c.eligible ? "" : " mj-class--locked"}`}
                  data-testid="plan-class"
                  data-class={c.class_code}
                >
                  <span className="mj-class__pic">
                    <VehiclePictogram picture={CLASS_PICTURE[c.class_code] ?? "car"} />
                  </span>
                  <span>
                    <span className="mj-class__name">
                      {c.eligible ? (
                        <StatusGlyph kind="done" size={16} />
                      ) : (
                        <StatusGlyph kind="later" size={16} />
                      )}{" "}
                      {rt(c.name_key, row?.name.en)} <span className="mj-code">{c.class_code}</span>
                    </span>
                    <span className="mj-class__meta">
                      {c.eligible ? (
                        <span>{t("canApply")}</span>
                      ) : c.eligible_from ? (
                        <span>{t("from", { date: date(c.eligible_from, "long") })}</span>
                      ) : (
                        <span>{rt(c.reason_key)}</span>
                      )}
                      {c.requires.map((r) => (
                        <span key={r}>{t(`requires.${r}` as "requires.FORM_1A")}</span>
                      ))}
                      {c.content_depth !== "deep" ? <span>{t("contentComing")}</span> : null}
                      {c.verify_at_rto ? <VerifyChip /> : null}
                    </span>
                  </span>
                </div>
              );
            })}
          </section>

          <section className="mj-card" aria-labelledby="pc-facts">
            <h2 id="pc-facts" className="md-sr-only">
              {t("factsTitle")}
            </h2>
            <dl className="mj-facts">
              <div>
                <dt>{t("earliest")}</dt>
                <dd data-testid="fact-earliest">
                  {earliest ? (
                    <>
                      <span aria-hidden="true">~ </span>
                      <span className="md-sr-only">{t("about")} </span>
                      <span className="mj-num">{date(earliest)}</span>
                    </>
                  ) : (
                    t("unknown")
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("steps")}</dt>
                <dd className="mj-num" data-testid="fact-steps">
                  <CountUp to={plan.steps.length} duration={0.5} />
                </dd>
              </div>
              <div>
                <dt>{t("visits")}</dt>
                <dd data-testid="fact-visits">{t("visitsValue", { n: visits })}</dd>
              </div>
              <div>
                <dt>{t("fee")}</dt>
                <dd>
                  {plan.fees ? (
                    <button
                      type="button"
                      className="mj-fact-button"
                      onClick={() => setFeesOpen(true)}
                      aria-label={t("feeButton", { fee: inr(plan.fees.total_paise) })}
                      data-testid="fact-fee"
                    >
                      <span className="mj-num">{inr(plan.fees.total_paise)}</span>
                      <ChevronRight aria-hidden="true" size={18} />
                    </button>
                  ) : (
                    t("unknown")
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("documents")}</dt>
                <dd className="mj-num">{docs.length}</dd>
              </div>
              <div>
                <dt>{t("toSort")}</dt>
                <dd>
                  <Link
                    href={`/plan/blockers?id=${encodeURIComponent(record.id)}`}
                    className="md-link"
                  >
                    {needsYou.length > 0
                      ? t("toSortValue", { n: needsYou.length })
                      : t("toSortNone")}
                  </Link>
                </dd>
              </div>
            </dl>
            <p className="mj-caption">{t("earliestInfo")}</p>
          </section>

          {needsYou.length > 0 ? (
            <section className="mj-issues" aria-labelledby="pc-needs" data-testid="plan-issues">
              <h2 id="pc-needs" className="mj-h2">
                {t("needsYou")}
              </h2>
              {needsYou.map((i) => (
                <IssueCard key={i.rule_id} issue={i} action={issueAction(i)} />
              ))}
            </section>
          ) : null}
          {sorted.length > 0 ? (
            <p className="mj-caption">{ti("sortedCount", { n: sorted.length })}</p>
          ) : null}

          {plan.saving ? (
            <section className="mj-card mj-card--soft" aria-labelledby="pc-bundle">
              <h2 id="pc-bundle" className="mj-h2">
                {t("bundleTitle", { n: plan.saving.classes_on_one_ll })}
              </h2>
              <p>{t("bundleBody", { days: plan.saving.wait_days_saved })}</p>
              <Link href={`/plan/classes?id=${encodeURIComponent(record.id)}`} className="md-link">
                {t("bundleSee")}
                <ChevronRight aria-hidden="true" size={18} />
              </Link>
            </section>
          ) : (
            <p>
              <Link href={`/plan/classes?id=${encodeURIComponent(record.id)}`} className="md-link">
                {t("addClass")}
                <ChevronRight aria-hidden="true" size={18} />
              </Link>
            </p>
          )}

          {later.length > 0 && plan.bundles.length > 1 ? (
            <Banner tone="info" title={t("laterTitle")}>
              {t("laterBody", {
                classes: later
                  .map((c) => rt(c.name_key, classByCode(c.class_code)?.name.en))
                  .join(", "),
                date: date(
                  plan.bundles[1]?.ll_from ?? later[0]?.eligible_from ?? istToday(),
                  "long",
                ),
              })}
            </Banner>
          ) : null}
        </div>

        <div className="mj-screen">
          <section className="mj-card" aria-labelledby="pc-road">
            <h2 id="pc-road" className="mj-h2">
              {t("road")}
            </h2>
            <ol className="mj-road" aria-label={t("road")}>
              {plan.steps.map((s) => {
                const fee = stepFee(s.key);
                return (
                  <li key={s.n} data-testid="plan-step">
                    <span>
                      <span className="mj-road__label">{rt(`step.${s.key}`)}</span>
                      {s.due_on && s.key !== "ll.apply" ? (
                        <span className="mj-road__meta">
                          {t("stepFrom", { date: date(s.due_on) })}
                        </span>
                      ) : null}
                      {s.at_rto && s.visit ? (
                        <span className="mj-road__visit">{t("rtoVisit", { n: s.visit })}</span>
                      ) : null}
                    </span>
                    {fee ? <span className="mj-road__fee">{fee}</span> : <span />}
                  </li>
                );
              })}
            </ol>
            <p className="mj-caption">
              {plan.ll_test.mode === "rto" ? t("llAtRto") : t("llOnline")}
              {plan.ll_test.known
                ? ` ${t("llFormat", { q: plan.ll_test.questions, pass: plan.ll_test.pass_correct })}`
                : ""}
            </p>
            {path?.path_id === "non_aadhaar" ? (
              <p className="mj-caption">{t("nonAadhaarPath")}</p>
            ) : null}
          </section>

          <section className="mj-card" aria-labelledby="pc-docs">
            <h2 id="pc-docs" className="mj-h2">
              {t("docsTitle")}
            </h2>
            <ul className="mj-ticks">
              {plan.documents.map((d) => (
                <li key={d.doc_id} data-testid="plan-doc" data-doc={d.doc_id}>
                  <StatusGlyph kind={d.required ? "now" : "later"} size={20} />
                  <span>
                    {rt(d.text_key)}
                    {!d.required ? <span className="mj-caption"> · {t("docMaybe")}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {notices.length > 0 ? (
            <Disclosure className="md-why">
              <Disclosure.Heading className="md-why__heading">
                <Disclosure.Trigger className="md-why__trigger">
                  <StatusGlyph kind="info" size={20} />
                  <span>{t("keepInMind", { n: notices.length })}</span>
                  <Disclosure.Indicator className="md-why__indicator" />
                </Disclosure.Trigger>
              </Disclosure.Heading>
              <Disclosure.Content>
                <Disclosure.Body className="md-why__body">
                  <div className="mj-issues">
                    {notices.map((i) => (
                      <IssueCard key={i.rule_id} issue={i} headingLevel={4} />
                    ))}
                  </div>
                </Disclosure.Body>
              </Disclosure.Content>
            </Disclosure>
          ) : null}

          <div className="mj-chips">
            <RuleSource
              prov={{
                source_title: t("rulesFor", { state: tc(`state.${plan.state}` as "state.JK") }),
                source_url: "",
                grade: "",
                checked_on: checkedOn,
                confidence: plan.rule_pack.partial ? "low" : "medium",
                verified: !plan.rule_pack.partial,
              }}
              detail={t("rulesDetail", { version: plan.rule_pack.version })}
            />
          </div>
        </div>
      </div>

      <div className="mj-sticky mj-actions">
        {stop ? (
          <Link
            href="/learn"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          >
            {t("ctaWait")}
          </Link>
        ) : (
          <Link
            href={`/apply/start?plan=${encodeURIComponent(record.id)}`}
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            data-testid="start-application"
          >
            {minor
              ? t("ctaMinor")
              : record.answers.intent === "have_ll"
                ? tFlow("planCtaDl")
                : t("cta")}
          </Link>
        )}
        <Button variant="secondary" size="lg" onPress={() => setShareOpen(true)}>
          {t("whatsapp")}
        </Button>
      </div>

      <Sheet
        isOpen={feesOpen}
        onOpenChange={setFeesOpen}
        title={tf("title")}
        description={`${names} · ${tc(`state.${plan.state}` as "state.JK")}`}
        closeLabel={tc("close")}
      >
        {plan.fees ? <FeeBreakdown quote={plan.fees} /> : null}
        {plan.fees && plan.requested_classes.length > 1 ? <OneClassNote /> : null}
      </Sheet>
      <ShareSheet
        isOpen={shareOpen}
        onOpenChange={setShareOpen}
        minor={minor}
        link={shareLink}
        summary={{
          classes: names,
          fee: plan.fees ? inr(plan.fees.total_paise) : "",
          date: earliest ? date(earliest) : "",
          steps: plan.steps.length,
          visits,
          docs: docs.map((d) => rt(`docShort.${d.doc_id}`, d.doc_id)).join(", "),
        }}
      />
    </div>
  );
}

function OneClassNote() {
  const tf = useTranslations("fees");
  return (
    <p className="mj-caption" style={{ marginTop: 12 }}>
      {tf("oneClassNote")}
    </p>
  );
}
