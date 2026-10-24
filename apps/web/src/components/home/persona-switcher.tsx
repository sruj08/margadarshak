"use client";

import { Button } from "@margdarshak/ui/components/button";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ChoiceCards } from "@/components/journey/choices";
import { cacheCase, forgetCases, setActiveCase, setCaseFacts } from "@/lib/case/case-store";
import {
  API_MODE,
  computePlan,
  getCase,
  listDemoPersonas,
  listFamilyMembers,
  startDemoPersona,
} from "@/lib/journey/api";
import { istToday } from "@/lib/journey/dates";
import { idbDel, idbSet } from "@/lib/journey/idb";
import { seedPersonaCase } from "@/lib/journey/mock-api";
import { buildPersona, PERSONA_IDS, type PersonaId } from "@/lib/journey/personas";
import { toEngineInput } from "@/lib/journey/plan-model";
import { savePlan } from "@/lib/journey/plan-store";
import { planOnDevice } from "@/lib/journey/rules";
import { deriveCase } from "@/lib/journey/stage";
import { KEYS, newId, writeJson } from "@/lib/journey/storage";

/**
 * Real API (MD-122): POST /v1/demo/personas/{id}/session signs this browser in as the synthetic
 * persona (the API re-seeds its case relative to server today); the persona's case comes from
 * GET /v1/me/licences + GET /v1/cases/{id}, its plan from API-01. Only the plan answers (synthetic
 * DOB, vehicles) are taken from personas.ts, because the server never returns a date of birth.
 */
async function loadServerPersona(id: PersonaId): Promise<void> {
  const p = buildPersona(id, istToday());
  forgetCases();
  seedPersonaCase(null, null, []);
  const items = await startDemoPersona(id);
  const item = (id === "rahul" ? items.find((i) => i.for_family_member) : undefined) ?? items[0];
  if (!item) {
    writeJson(KEYS.persona, id === "kabir_new" ? null : id);
    return;
  }
  const res = await getCase(item.case_id);
  let planId: string | null = null;
  if (p.plan) {
    const rec = await computePlan(p.plan);
    savePlan(rec);
    planId = rec.id;
    setCaseFacts(item.case_id, p.plan);
  }
  await idbDel("drafts", item.case_id);
  cacheCase(res.data);
  const memberId = res.data.family_member_id ?? null;
  const member = memberId
    ? ((await listFamilyMembers()).find((m) => m.member_id === memberId) ?? null)
    : null;
  setActiveCase({
    caseId: item.case_id,
    planId,
    memberId,
    memberLabel: member?.label ?? null,
    minor: member?.is_minor ?? false,
    persona: id,
    local: false,
  });
  writeJson(KEYS.persona, id);
}

/**
 * Loads a synthetic persona (SCR-061, MD-122, demo tenant only). With a real API it signs in as the
 * API's seed persona; in mock mode it mirrors the seed personas (services/api/internal/seed) on this
 * device: the case lands in the local mock API and the cache, the plan facts in the case store, and
 * a "Demo persona" chip shows on the home.
 */
export async function loadPersona(id: PersonaId, server = API_MODE === "real"): Promise<void> {
  if (server) return loadServerPersona(id);
  const today = istToday();
  const p = buildPersona(id, today);
  forgetCases();
  if (!p.case) {
    seedPersonaCase(null, null, []);
    writeJson(KEYS.persona, id === "kabir_new" ? null : id);
    return;
  }
  seedPersonaCase(p.case, p.member, p.consents);
  let planId: string | null = null;
  if (p.plan) {
    const plan = planOnDevice(toEngineInput(p.plan, today));
    planId = newId("pln_demo");
    savePlan({
      id: planId,
      createdAt: new Date().toISOString(),
      asOf: today,
      answers: p.plan,
      plan,
      source: "device",
      serverPlanId: null,
    });
    setCaseFacts(p.case.case_id, p.plan);
  }
  await idbDel("drafts", p.case.case_id);
  await idbSet("drafts", p.case.case_id, {
    answers: p.answers,
    savedAt: new Date().toISOString(),
    pending: false,
  });
  cacheCase(deriveCase({ ...p.case, server_time: new Date().toISOString() }, today));
  setActiveCase({
    caseId: p.case.case_id,
    planId,
    memberId: p.member?.member_id ?? null,
    memberLabel: p.member?.label ?? null,
    minor: p.member?.is_minor ?? false,
    persona: id,
    local: false,
  });
  writeJson(KEYS.persona, id);
}

const NEW_VISITOR = "new_visitor";

/** Back to the first-time, logged-out view: clears the case and persona held on this device. */
function resetToNewVisitor(): void {
  forgetCases();
  seedPersonaCase(null, null, []);
  writeJson(KEYS.persona, null);
}

export function PersonaSwitcher() {
  const t = useTranslations("personas");
  const ta = useTranslations("a11y");
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<PersonaId | typeof NEW_VISITOR | null>(null);
  const [busy, setBusy] = useState(false);
  // Real API: offer the personas GET /v1/demo/personas lists. "device" = mock mode, or the API
  // does not offer them (404 outside the demo tenant), so the device personas are used.
  const [offered, setOffered] = useState<readonly PersonaId[] | "device" | null>(
    API_MODE === "real" ? null : "device",
  );
  useEffect(() => {
    if (!open || offered !== null) return;
    void listDemoPersonas().then((items) => {
      if (!items) return setOffered("device");
      const ids = new Set(items.map((i) => i.persona_id));
      setOffered(PERSONA_IDS.filter((pid) => ids.has(pid)));
    });
  }, [open, offered]);
  const fromServer = offered !== "device";
  return (
    <>
      <Button variant="ghost" onPress={() => setOpen(true)} data-testid="persona-open">
        <Users aria-hidden="true" />
        {t("open")}
      </Button>
      <Sheet
        isOpen={open}
        onOpenChange={setOpen}
        title={t("title")}
        description={t("description")}
        closeLabel={ta("close")}
        footer={
          <Button
            variant="primary"
            size="lg"
            isDisabled={!value}
            isPending={busy}
            data-testid="persona-load"
            onPress={async () => {
              if (!value) return;
              setBusy(true);
              if (value === NEW_VISITOR) {
                resetToNewVisitor();
              } else {
                await loadPersona(value, fromServer).catch(() => loadPersona(value, false));
              }
              setBusy(false);
              setOpen(false);
            }}
          >
            {t("load")}
          </Button>
        }
      >
        <p id="persona-label" className="md-sr-only">
          {t("title")}
        </p>
        <ChoiceCards
          labelledBy="persona-label"
          value={value}
          onChange={(v) => setValue(v as PersonaId | typeof NEW_VISITOR)}
          choices={[
            {
              id: NEW_VISITOR,
              label: t("p.new_visitor.name"),
              description: t("p.new_visitor.line"),
            },
            ...(offered === "device" || offered === null ? PERSONA_IDS : offered).map((id) => ({
              id: id as string,
              label: t(`p.${id}.name`),
              description: t(`p.${id}.line`),
            })),
          ]}
        />
      </Sheet>
    </>
  );
}
