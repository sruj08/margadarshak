"use client";

import { Disclosure, Input, Label, Switch } from "@heroui/react";
import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { notify } from "@margdarshak/ui/components/toast";
import { Download, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useFmt } from "@/components/journey/rule-source";
import { Link } from "@/i18n/navigation";
import { CASE_KEYS, forgetCases, getActiveCase } from "@/lib/case/case-store";
import { readVault } from "@/lib/case/vault";
import {
  changeConsent,
  deleteCase,
  deleteMe,
  exportServerData,
  isOffline,
  listConsents,
  NOTICE_VERSION,
  signOut,
  whoAmI,
} from "@/lib/journey/api";
import type { ConsentArtefact, ConsentPurpose } from "@/lib/journey/api-types";
import { idbDel, idbEntries } from "@/lib/journey/idb";
import { KEYS, readJson, writeJson } from "@/lib/journey/storage";
import { resetAnalytics, track } from "@/lib/journey/track";
import { download } from "@/lib/journey/trial-log";
import { GRIEVANCE_EMAIL } from "@/lib/site";

/** Purposes a person can switch here (PRIVACY.md §4.2 mapped to the API-60 enum). */
const PURPOSES = [
  "whatsapp_updates",
  "email_updates",
  "web_push",
  "ai_coach",
  "ai_voice",
  "analytics",
  "field_study",
  "helper_link",
  "school_share",
  "parent_card",
] as const satisfies readonly ConsentPurpose[];

/**
 * Privacy centre (SCR-150..153, MD-134, F-54): every consent with one-tap on/off (never pre-ticked,
 * off as easy as on), export of everything held (server copy via API-61 plus this phone's data),
 * and delete with clear consequences (API-62 / API-17): reminders are cancelled (EC-26) and
 * nothing on Sarathi is touched. Grievance officer contact and the notice version are shown.
 */
export function PrivacyCentre() {
  const t = useTranslations("privacyCentre");
  const tp = useTranslations("purpose");
  const tc = useTranslations("common");
  const tx = useTranslations("a11y");
  const locale = useLocale();
  const { date } = useFmt();
  const [consents, setConsents] = useState<ConsentArtefact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState<ConsentPurpose | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [word, setWord] = useState("");
  const [deleted, setDeleted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [minorCase, setMinorCase] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const confirmWord = t("deleteWord");

  const load = async () => {
    try {
      const r = await listConsents();
      setConsents(r.data);
      setOffline(false);
    } catch (e) {
      if (isOffline(e)) setOffline(true);
    } finally {
      setLoaded(true);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load();
    setMinorCase(getActiveCase()?.minor ?? false);
    void whoAmI().then((r) => setSignedIn(r.signedIn));
  }, []);

  const activeFor = (p: ConsentPurpose) =>
    consents.find((c) => c.purpose === p && c.status === "active");

  const toggle = async (p: ConsentPurpose, on: boolean) => {
    setPending(p);
    try {
      await changeConsent(p, on ? "grant" : "revoke");
      if (p === "analytics" && !on) resetAnalytics();
      // Sent only if analytics is (now) granted; the purpose is a code, never free text.
      track("consent_changed", { purpose: p, action: on ? "grant" : "revoke" });
      await load();
      notify(on ? t("granted") : t("revoked"), { tone: "success" });
    } catch (e) {
      notify(isOffline(e) ? t("needsInternet") : tc("somethingWrong"));
    } finally {
      setPending(null);
    }
  };

  const exportAll = async () => {
    setBusy(true);
    let server: unknown = null;
    let serverNote = "";
    try {
      const r = await exportServerData();
      server = r.data;
      serverNote = r.source === "server" ? "server" : "device";
    } catch {
      serverNote = "unavailable";
    }
    const active = getActiveCase();
    const drafts = await idbEntries<unknown>("drafts");
    const device = {
      plans: readJson(KEYS.plans, []),
      active_case: active,
      case_store: Object.fromEntries(CASE_KEYS.map((k) => [k, readJson(k, null)])),
      drafts: Object.fromEntries(drafts),
      vault: active ? await readVault(active.caseId) : {},
      documents: readJson("md.case.docs.v1", {}),
    };
    const file = {
      exported_at: new Date().toISOString(),
      notice_version: NOTICE_VERSION,
      language: locale,
      note: t("exportNote"),
      server: { source: serverNote, data: server },
      this_phone: device,
      never_collected: [
        "aadhaar_number",
        "vid",
        "otp",
        "biometrics",
        "bank_details",
        "document_images",
      ],
    };
    download("margdarshak-my-data.json", JSON.stringify(file, null, 2), "application/json");
    setBusy(false);
    notify(t("exported"), { tone: "success" });
  };

  const removeEverything = async () => {
    setBusy(true);
    const active = getActiveCase();
    let cancelled = 0;
    try {
      if (active) cancelled += (await deleteCase(active.caseId)).data.cancelled.length;
      cancelled += (await deleteMe()).data.cancelled.length;
    } catch {
      // the device copy is removed below in any case
    }
    if (active) {
      await idbDel("drafts", active.caseId);
      await idbDel("vault", `case:${active.caseId}`);
    }
    forgetCases();
    writeJson(KEYS.plans, null);
    writeJson(KEYS.persona, null);
    writeJson("md.case.docs.v1", null);
    setDeleted(cancelled);
    setDelOpen(false);
    setBusy(false);
    setWord("");
    void load();
  };

  return (
    <div className="mj-screen" data-screen="SCR-150">
      <header className="mj-head">
        <div className="mj-glow" aria-hidden="true" />
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{t("sub")}</p>
      </header>

      {deleted !== null ? (
        <Banner tone="success" title={t("deletedTitle")} role="status">
          {t("deletedBody", { n: deleted })}
        </Banner>
      ) : null}

      <section className="mj-card" aria-labelledby="pv-never">
        <h2 id="pv-never" className="mj-h2">
          {t("neverTitle")}
        </h2>
        <ul className="mj-never">
          {(["aadhaar", "otp", "bio", "bank", "images"] as const).map((k) => (
            <li key={k}>{t(`never.${k}`)}</li>
          ))}
        </ul>
      </section>

      <section className="mj-card" aria-labelledby="pv-choices" data-testid="consents">
        <h2 id="pv-choices" className="mj-h2">
          {t("choicesTitle")}
        </h2>
        {minorCase ? <p className="mj-muted">{t("familyNote")}</p> : null}
        {offline ? (
          <Banner tone="offline" title={t("offlineTitle")}>
            {t("offlineBody")}
          </Banner>
        ) : null}
        <div>
          {PURPOSES.map((p) => {
            const art = activeFor(p);
            return (
              <div key={p} className="mj-consent" id={`consent-${p}`} data-testid={`consent-${p}`}>
                <Switch
                  isSelected={!!art}
                  isDisabled={!loaded || offline || pending === p}
                  onChange={(v) => void toggle(p, v)}
                  className="md-switch"
                >
                  <Switch.Content className="md-switch__row">
                    <span className="md-switch__text">
                      <span className="md-switch__label">{tp(`${p}.name`)}</span>
                      <span className="md-switch__hint">{tp(`${p}.ask`)}</span>
                    </span>
                    <Switch.Control className="md-switch__control">
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Content>
                </Switch>
                <Disclosure className="md-why">
                  <Disclosure.Heading className="md-why__heading">
                    <Disclosure.Trigger className="md-why__trigger">
                      <StatusGlyph kind="info" size={18} />
                      <span>{t("details", { name: tp(`${p}.name`) })}</span>
                      <Disclosure.Indicator className="md-why__indicator" />
                    </Disclosure.Trigger>
                  </Disclosure.Heading>
                  <Disclosure.Content>
                    <Disclosure.Body className="md-why__body">
                      <dl className="mj-facts">
                        <div>
                          <dt>{t("dPurpose")}</dt>
                          <dd>{tp(`${p}.purpose`)}</dd>
                        </div>
                        <div>
                          <dt>{t("dData")}</dt>
                          <dd>{tp(`${p}.data`)}</dd>
                        </div>
                        <div>
                          <dt>{t("dKept")}</dt>
                          <dd>{tp(`${p}.kept`)}</dd>
                        </div>
                        <div>
                          <dt>{t("dStatus")}</dt>
                          <dd>
                            {art
                              ? t("since", {
                                  date: date(art.granted_at.slice(0, 10)),
                                  version: art.notice_version,
                                })
                              : t("off")}
                          </dd>
                        </div>
                      </dl>
                    </Disclosure.Body>
                  </Disclosure.Content>
                </Disclosure>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mj-card" aria-labelledby="pv-export">
        <h2 id="pv-export" className="mj-h2">
          {t("exportTitle")}
        </h2>
        <p>{t("exportBody")}</p>
        <Button
          variant="secondary"
          size="lg"
          isPending={busy && !delOpen}
          onPress={() => void exportAll()}
          data-testid="export"
        >
          <Download aria-hidden="true" />
          {t("exportCta")}
        </Button>
      </section>

      <section className="mj-card" aria-labelledby="delete" id="delete-section">
        <h2 id="delete" className="mj-h2">
          {t("deleteTitle")}
        </h2>
        <ul className="mj-ticks">
          <li>
            <StatusGlyph kind="caution" size={20} />
            <span>{t("deleteWhat")}</span>
          </li>
          <li>
            <StatusGlyph kind="info" size={20} />
            <span>{t("deleteNot")}</span>
          </li>
          <li>
            <StatusGlyph kind="info" size={20} />
            <span>{t("deleteWhen")}</span>
          </li>
        </ul>
        <Button
          variant="outline"
          size="lg"
          onPress={() => setDelOpen(true)}
          data-testid="delete-open"
        >
          <Trash2 aria-hidden="true" />
          {t("deleteCta")}
        </Button>
      </section>

      {/* Below the consents: loading it never shifts the switches. */}
      {signedIn !== null ? (
        <section className="mj-card" aria-labelledby="pv-account" data-testid="account">
          <h2 id="pv-account" className="mj-h2">
            {t("accountTitle")}
          </h2>
          <p>{signedIn ? t("accountIn") : t("accountOut")}</p>
          {signedIn ? (
            <Button
              variant="tertiary"
              onPress={async () => {
                await signOut();
                setSignedIn(false);
              }}
            >
              {t("signOut")}
            </Button>
          ) : (
            <Link href="/signin?return=%2Fprivacy" className="md-link" data-testid="account-signin">
              {t("signIn")}
            </Link>
          )}
        </section>
      ) : null}

      <section className="mj-card mj-card--well" aria-labelledby="pv-help">
        <h2 id="pv-help" className="mj-card__title">
          {t("helpTitle")}
        </h2>
        <p>
          {t("grievance")}{" "}
          <a className="md-link md-email" href={`mailto:${GRIEVANCE_EMAIL}`}>
            {GRIEVANCE_EMAIL}
          </a>
        </p>
        <p>
          <Link href="/privacy/notice" className="md-link">
            {t("notice")}
          </Link>
        </p>
        <p className="mj-caption">{t("version", { version: NOTICE_VERSION })}</p>
      </section>

      <Sheet
        isOpen={delOpen}
        onOpenChange={(o) => {
          setDelOpen(o);
          if (!o) setWord("");
        }}
        title={t("confirmTitle")}
        description={t("confirmDesc")}
        closeLabel={tx("close")}
        footer={
          <div className="mj-actions" style={{ width: "100%" }}>
            <Button variant="secondary" size="lg" onPress={() => setDelOpen(false)}>
              {t("keep")}
            </Button>
            <Button
              variant="danger"
              size="lg"
              isDisabled={word.trim().toLocaleLowerCase() !== confirmWord.toLocaleLowerCase()}
              isPending={busy}
              onPress={() => void removeEverything()}
              data-testid="delete-confirm"
            >
              {t("deleteNow")}
            </Button>
          </div>
        }
      >
        <div className="mj-input-group">
          <Label htmlFor="del-word" className="md-field__label">
            {t("typeWord", { word: confirmWord })}
          </Label>
          <Input
            id="del-word"
            className="mj-input"
            value={word}
            autoComplete="off"
            onChange={(e) => setWord(e.target.value)}
            data-testid="delete-word"
          />
        </div>
      </Sheet>
    </div>
  );
}
