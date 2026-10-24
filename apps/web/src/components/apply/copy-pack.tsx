"use client";

import { adapterProvenance } from "@margdarshak/api-client";
import { Button } from "@margdarshak/ui/components/button";
import { SimulatedChip } from "@margdarshak/ui/components/simulated-chip";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { notify } from "@margdarshak/ui/components/toast";
import { Copy, Eye, EyeOff, Volume2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { BackLink } from "@/components/journey/status";
import { useCaseSession } from "@/lib/case/use-case-session";
import { getHandoff } from "@/lib/journey/api";
import type { HandoffPack } from "@/lib/journey/api-types";
import { classByCode } from "@/lib/journey/rules";
import { recordScreen } from "@/lib/journey/trial-log";

/**
 * Copy-pack (SCR-041, MD-114, API-16): every value Sarathi asks for, in Sarathi's order and
 * Sarathi's own labels. The server returns only the template (labels, order, vault keys); personal
 * values come from this phone's vault and never leave it. Date of birth is "type it" (Sarathi
 * blocks paste on that field). No Aadhaar number, ever.
 */
export function CopyPack() {
  const t = useTranslations("pack");
  const ts = useTranslations("simulated");
  const tc = useTranslations("common");
  const locale = useLocale();
  const s = useCaseSession();
  const [pack, setPack] = useState<HandoffPack | null>(null);
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    recordScreen("apply.pack");
  }, []);

  useEffect(() => {
    if (!s.active || !s.plan) return;
    void getHandoff(s.active.caseId, tc(`stateSarathi.${s.plan.state}` as "stateSarathi.JK"))
      .then((r) => setPack(r.data))
      .catch(() => setFailed(true));
  }, [s.active, s.plan, tc]);

  if (!s.ready || (!pack && !failed)) return <Skeleton className="mj-skel-row" />;

  const dob = (): string => {
    const a = s.facts?.age;
    if (a?.kind === "dob") {
      const [y, m, d] = a.dob.split("-");
      return `${d}-${m}-${y}`;
    }
    return t("dobAsAadhaar");
  };

  const sarathiValue = (
    labelKey: string,
    raw: string | null | undefined,
    vaultKey: string | null | undefined,
  ): string => {
    if (vaultKey === "dob") return dob();
    if (vaultKey) return s.vault[vaultKey] ?? t("missing");
    if (labelKey === "classes") {
      return (raw ?? "")
        .split(",")
        .map((c) => classByCode(c.trim())?.sarathiCode ?? c.trim())
        .join(", ");
    }
    if (labelKey === "category" || labelKey === "licence_held" || labelKey === "country_of_birth")
      return t(`value.${labelKey}.${raw ?? "none"}` as "value.category.general");
    return raw ?? "";
  };

  const rows =
    pack?.steps.flatMap((st) =>
      st.fields.map((f) => ({
        key: `${st.order}-${f.label_key}`,
        label: t(`label.${f.label_key}` as "label.state"),
        value: sarathiValue(f.label_key, f.value, f.vault_key),
        typeOnly: f.vault_key === "dob",
        personal: !!f.vault_key && f.vault_key !== "dob",
      })),
    ) ?? [];

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(t("copied", { label }), { tone: "success" });
    } catch {
      notify(t("copyFailed"));
    }
  };

  const readAll = () => {
    if (!("speechSynthesis" in window)) return;
    const text = rows
      .map((r) => `${r.label}: ${r.typeOnly ? r.value.split("").join(" ") : r.value}`)
      .join(". ");
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale === "hi" ? "hi-IN" : "en-IN";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  const prov = adapterProvenance(pack);

  return (
    <div className="mj-screen" data-screen="SCR-041">
      <BackLink href="/apply/handoff">{t("back")}</BackLink>
      <header className="mj-head">
        <div className="mj-toprow">
          <h1 className="mj-title">{t("h1")}</h1>
          <Button variant="ghost" onPress={() => setHidden((h) => !h)}>
            {hidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            {hidden ? t("show") : t("hide")}
          </Button>
        </div>
        <p className="mj-sub">{t("sub")}</p>
        <SimulatedChip
          adapterMode={prov.adapterMode}
          simulated={prov.simulated}
          label={ts("chip")}
          detail={ts("detailSarathi")}
        />
      </header>
      {failed ? <p className="mj-muted">{t("failed")}</p> : null}
      {pack?.steps.map((st) => (
        <section
          key={st.order}
          className="mj-card mj-pack-screen"
          aria-labelledby={`pk-${st.order}`}
        >
          <h2 id={`pk-${st.order}`} className="mj-card__title">
            {t(`screen.${st.screen_hint_key}` as "screen.select_state")}
          </h2>
          {st.note_key ? (
            <p className="mj-pack-screen__hint">
              {t(`note.${st.note_key}` as "note.ekyc_on_sarathi")}
            </p>
          ) : null}
          {st.fields.map((f) => {
            const label = t(`label.${f.label_key}` as "label.state");
            const v = sarathiValue(f.label_key, f.value, f.vault_key);
            const masked = hidden && !!f.vault_key;
            return (
              <div key={f.label_key} className="mj-pack-row" data-testid={`pack-${f.label_key}`}>
                <span className="mj-pack-row__label">{label}</span>
                <span />
                <span
                  className={`mj-pack-row__value${masked ? " mj-pack-row__value--masked" : ""}${v.length > 24 ? " mj-pack-row__value--long" : ""}`}
                  data-testid={`pack-value-${f.label_key}`}
                >
                  {masked ? "••••••" : v}
                </span>
                {f.copyable && !masked ? (
                  <Button
                    variant="secondary"
                    onPress={() => void copy(label, v)}
                    aria-label={t("copyLabel", { label })}
                  >
                    <Copy aria-hidden="true" />
                    {t("copy")}
                  </Button>
                ) : (
                  <span />
                )}
                {f.vault_key === "dob" ? (
                  <span className="mj-pack-row__note">{t("typeOnly")}</span>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}
      <p className="mj-muted">{t("never")}</p>
      <div className="mj-actions">
        <Button variant="secondary" size="lg" onPress={readAll}>
          <Volume2 aria-hidden="true" />
          {t("readAll")}
        </Button>
      </div>
      <p className="mj-caption">{t("fromObserved")}</p>
    </div>
  );
}
