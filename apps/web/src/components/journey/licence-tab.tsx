"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { notify } from "@margdarshak/ui/components/toast";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { cacheCase, useActiveCase, useCachedCase } from "@/lib/case/case-store";
import { getCase, getTimeline, isOffline, postEvent } from "@/lib/journey/api";
import type { CaseEventType, TimelineEvent } from "@/lib/journey/api-types";
import { daysBetween, istToday, serverToday } from "@/lib/journey/dates";
import { stageView } from "@/lib/journey/stage";
import { recordScreen } from "@/lib/journey/trial-log";
import { CaseCountdown } from "./case-clock";
import { ChoiceCards } from "./choices";
import { DateParts, type DateValue, fromIso, toIso } from "./date-parts";
import { ParcelTracker } from "./parcel-tracker";
import { useFmt } from "./rule-source";
import { useRuleText } from "./rule-text";

const EVENTS: CaseEventType[] = [
  "ll_issued",
  "slot_booked",
  "test_failed",
  "test_passed",
  "approved",
  "card_received",
];

/**
 * My Licence tab (SCR-070, MD-123, MD-124, MD-132): the parcel tracker, the case clock, the LL and
 * DL mirrors (user-entered; numbers only as the last 4), a DigiLocker pointer for DL holders, the
 * case timeline from API-14, and "Update a step" (API-15 events). Honest: we cannot see Sarathi.
 */
export function LicenceTab() {
  const t = useTranslations("licenceTab");
  const tl = useTranslations("licence");
  const tc = useTranslations("common");
  const tx = useTranslations("a11y");
  const th = useTranslations("homeStage");
  const rt = useRuleText();
  const { date } = useFmt();
  const active = useActiveCase();
  const cached = useCachedCase(active?.caseId);
  const [ready, setReady] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [ev, setEv] = useState<CaseEventType | null>(null);
  const [when, setWhen] = useState<DateValue>(fromIso(istToday()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setReady(true);
    recordScreen("licence.tracker");
    const params = new URLSearchParams(window.location.search);
    const u = params.get("update");
    if (u && (EVENTS as string[]).includes(u)) {
      setEv(u as CaseEventType);
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void getCase(active.caseId)
      .then((r) => cacheCase(r.data))
      .catch(() => undefined);
    void getTimeline(active.caseId)
      .then((r) => setTimeline(r.data.items))
      .catch(() => setTimeline([]));
  }, [active]);

  if (!ready) return <Skeleton className="mj-skel-row" />;
  if (!active || !cached) {
    return (
      <div className="mj-screen" data-screen="SCR-070">
        <h1 className="mj-title">{tl("title")}</h1>
        <EmptyState
          title={tl("emptyTitle")}
          line={tl("emptyLine")}
          action={
            <Link href="/plan" className={buttonClassName({ variant: "primary", size: "lg" })}>
              {tl("emptyCta")}
            </Link>
          }
        />
      </div>
    );
  }

  const view = stageView(cached, serverToday());
  const classes = cached.classes.map((c) => c.class_code).join(" + ");
  const llDays = cached.ll ? daysBetween(serverToday(), cached.ll.expires_on) : null;

  const record = async () => {
    const iso = toIso(when);
    if (!ev || !iso) {
      setErr(t("errEvent"));
      return;
    }
    if (iso > istToday()) {
      setErr(t("errFuture"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await postEvent(active.caseId, {
        type: ev,
        occurred_on: iso,
        ...(ev === "slot_booked" ? { payload: { slot_date: iso } } : {}),
      });
      const fresh = await getCase(active.caseId);
      cacheCase(fresh.data);
      const tl2 = await getTimeline(active.caseId);
      setTimeline(tl2.data.items);
      notify(t("recorded"), { tone: "success" });
      setOpen(false);
    } catch (e) {
      setErr(isOffline(e) ? t("needsInternet") : tc("somethingWrong"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mj-screen" data-screen="SCR-070">
      <header className="mj-head">
        <div className="mj-glow" aria-hidden="true" />
        <p className="mj-eyebrow">
          {classes} · {tc(`state.${cached.tenant}` as "state.JK")}
        </p>
        <h1 className="mj-title">{tl("title")}</h1>
        <p className="mj-muted">{th(`now.${view.display}` as "now.PLAN")}</p>
      </header>

      <div className="mj-two">
        <section className="mj-card" aria-labelledby="lt-road">
          <h2 id="lt-road" className="mj-h2">
            {t("road")}
          </h2>
          <ParcelTracker data={cached} />
          <p className="mj-caption">
            {t("honest", { state: tc(`state.${cached.tenant}` as "state.JK") })}
          </p>
          <Button
            variant="secondary"
            size="lg"
            onPress={() => setOpen(true)}
            data-testid="update-step"
          >
            {t("update")}
          </Button>
        </section>

        <div className="mj-screen">
          {view.clock ? (
            <section className="mj-card" aria-labelledby="lt-clock">
              <h2 id="lt-clock" className="mj-card__title">
                {t("clock")}
              </h2>
              <CaseCountdown
                clock={view.clock}
                tone={view.tone}
                caseId={cached.case_id}
                sourceRuleId={view.clock.ruleId}
              />
            </section>
          ) : null}

          {cached.ll ? (
            <section className="mj-card" aria-labelledby="lt-ll" data-testid="ll-mirror">
              <h2 id="lt-ll" className="mj-h2">
                {t("llTitle")}
              </h2>
              <dl className="mj-facts">
                <div>
                  <dt>{t("issued")}</dt>
                  <dd className="mj-num">{date(cached.ll.issued_on)}</dd>
                </div>
                <div>
                  <dt>{t("validUntil")}</dt>
                  <dd className="mj-num">{date(cached.ll.expires_on)}</dd>
                </div>
                <div>
                  <dt>{t("classes")}</dt>
                  <dd>{cached.ll.classes.join(", ")}</dd>
                </div>
                {cached.ll.number_last4 ? (
                  <div>
                    <dt>{t("number")}</dt>
                    <dd className="mj-num">•••• {cached.ll.number_last4}</dd>
                  </div>
                ) : null}
              </dl>
              {llDays !== null && llDays >= 0 && !cached.dl ? (
                <p className="mj-caption">{t("llLeft", { n: llDays })}</p>
              ) : null}
            </section>
          ) : null}

          {cached.dl ? (
            <section className="mj-card" aria-labelledby="lt-dl" data-testid="dl-mirror">
              <h2 id="lt-dl" className="mj-h2">
                {t("dlTitle")}
              </h2>
              <dl className="mj-facts">
                <div>
                  <dt>{t("classes")}</dt>
                  <dd>{cached.dl.classes.join(", ")}</dd>
                </div>
                <div>
                  <dt>{t("validUntil")}</dt>
                  <dd className="mj-num">{date(cached.dl.valid_to_non_transport)}</dd>
                </div>
                {cached.dl.renewal_window_opens ? (
                  <div>
                    <dt>{t("renewFrom")}</dt>
                    <dd className="mj-num">{date(cached.dl.renewal_window_opens)}</dd>
                  </div>
                ) : null}
                {cached.dl.number_last4 ? (
                  <div>
                    <dt>{t("number")}</dt>
                    <dd className="mj-num">•••• {cached.dl.number_last4}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="mj-muted">{rt("notice.jk.digilocker_equal")}</p>
              <a
                href="https://www.digilocker.gov.in/"
                target="_blank"
                rel="noopener noreferrer"
                className="md-link"
              >
                {t("digilocker")} <ArrowUpRight aria-hidden="true" size={18} />
                <span className="md-sr-only"> {tx("externalNewTab")}</span>
              </a>
            </section>
          ) : null}

          {timeline.length > 0 ? (
            <section className="mj-card" aria-labelledby="lt-timeline">
              <h2 id="lt-timeline" className="mj-h2">
                {t("timeline")}
              </h2>
              <ul className="mj-coming">
                {timeline.map((e) => (
                  <li key={e.event_id}>
                    <span>
                      {th(`event.${e.code}` as "event.LL_EXPIRY")}
                      <span className="mj-caption"> · {t(`tl.${e.status}` as "tl.scheduled")}</span>
                    </span>
                    <span className="mj-num mj-muted">
                      {date((e.occurred_at ?? e.due_at ?? "").slice(0, 10))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {view.tone === "danger" ? (
            <Banner tone="danger" title={t("expiryTitle")}>
              {t("expiryBody")}
            </Banner>
          ) : null}
          <Link href="/privacy#delete" className="md-link">
            {t("deleteCase")}
          </Link>
        </div>
      </div>

      <Sheet
        isOpen={open}
        onOpenChange={setOpen}
        title={t("updateTitle")}
        description={t("updateDesc")}
        closeLabel={tx("close")}
        footer={
          <Button
            variant="primary"
            size="lg"
            isPending={busy}
            onPress={() => void record()}
            data-testid="record-event"
          >
            {t("record")}
          </Button>
        }
      >
        <div className="mj-screen" style={{ gap: 14 }}>
          <p id="ev-label" className="md-sr-only">
            {t("updateTitle")}
          </p>
          <ChoiceCards
            labelledBy="ev-label"
            value={ev}
            onChange={(v) => setEv(v as CaseEventType)}
            choices={EVENTS.map((e) => ({ id: e, label: t(`ev.${e}` as "ev.ll_issued") }))}
          />
          <DateParts
            legend={t("when")}
            value={when}
            onChange={setWhen}
            labels={{ day: tc("day"), month: tc("month"), year: tc("year") }}
          />
          {err ? <p className="mj-error">{err}</p> : null}
          <p className="mj-caption">{t("noNumbers")}</p>
        </div>
      </Sheet>
    </div>
  );
}
