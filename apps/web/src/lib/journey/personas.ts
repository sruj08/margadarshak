import type { Case, FamilyMember } from "./api-types";
import { addDays, addMonths } from "./dates";
import type { Answers } from "./form-engine";
import type { PlanAnswers } from "./plan-model";

/**
 * Demo personas (SCR-061, MD-122). Synthetic only, mirroring services/api/internal/seed (MD-054):
 * same names, dates of birth, states, classes and journey states. Dates are relative to the
 * server's today so "LL day 12" is always day 12. Demo tenant only: the switcher is hidden when
 * NEXT_PUBLIC_DEMO_TENANT is "0".
 */

export const PERSONA_IDS = [
  "kabir_new",
  "kabir_day12",
  "kabir_day31",
  "tanvi",
  "mohan",
  "rahul",
  "dl_holder",
] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];

export interface PersonaBuild {
  plan: PlanAnswers | null;
  case: Case | null;
  answers: Answers;
  member: FamilyMember | null;
  consents: string[];
}

const KABIR: PlanAnswers = {
  age: { kind: "dob", dob: "2007-06-15" },
  vehicles: ["bike_gear"],
  state: "JK",
  aadhaar: "yes",
};

const KABIR_DONE: Answers = {
  for_whom: "self",
  category: "general",
  licence_held: "none",
  aadhaar_address_match: "yes",
  mobile_linked: "yes",
  aadhaar_relation_line: "yes",
  form1: true,
  check_confirmed: true,
};

function baseCase(id: string, today: string, over: Partial<Case>): Case {
  return {
    case_id: id,
    tenant: "JK",
    state: "PLAN",
    stage: "S1",
    display_stage: "PLAN",
    alerts: [],
    path: "aadhaar_contactless",
    classes: [],
    answers: {},
    ll: null,
    dl: null,
    key_dates: {},
    next_action: { action_id: "RESUME_STEP", stage: "S1", title_key: "next.resume_step" },
    rule_pack_version: "2026.10.0",
    version: 1,
    flags: [],
    server_time: `${today}T04:30:00Z`,
    created_at: `${addDays(today, -40)}T04:30:00Z`,
    updated_at: `${today}T04:30:00Z`,
    ...over,
  };
}

function kabirLl(today: string, day: number): Case {
  const issued = addDays(today, -day);
  return baseCase(`cas_demo_kabir_d${day}`, today, {
    state: "BRIDGE",
    stage: "S4",
    display_stage: "BRIDGE",
    classes: [{ class_code: "MCWG", status: "ll_issued" }],
    answers: KABIR_DONE,
    ll: {
      issued_on: issued,
      expires_on: addMonths(issued, 6),
      classes: ["MCWG"],
      number_last4: "4471",
      source: "user_entered",
    },
    key_dates: {
      applied_on: addDays(issued, -1),
      ll_issued_on: issued,
      dl_test_unlock: addDays(issued, 30),
      ll_expires_on: addMonths(issued, 6),
    },
    created_at: `${addDays(issued, -2)}T04:30:00Z`,
  });
}

export function buildPersona(id: PersonaId, today: string): PersonaBuild {
  switch (id) {
    case "kabir_new":
      return { plan: null, case: null, answers: {}, member: null, consents: [] };
    case "kabir_day12":
      return {
        plan: KABIR,
        case: kabirLl(today, 12),
        answers: KABIR_DONE,
        member: null,
        consents: ["ai_coach", "email_updates"],
      };
    case "kabir_day31":
      return {
        plan: KABIR,
        case: kabirLl(today, 31),
        answers: KABIR_DONE,
        member: null,
        consents: ["ai_coach", "email_updates"],
      };
    case "tanvi": {
      const plan: PlanAnswers = {
        age: { kind: "dob", dob: "2007-02-20" },
        vehicles: ["scooter"],
        state: "JK",
        aadhaar: "no",
        relationLine: false,
        hasTestVehicle: false,
      };
      const answers: Answers = {
        for_whom: "self",
        aadhaar_address_match: "no",
        aadhaar_relation_line: "no",
      };
      return {
        plan,
        case: baseCase("cas_demo_tanvi", today, {
          path: "non_aadhaar_rto",
          classes: [{ class_code: "MCWOG", status: "planned" }],
          answers,
          key_dates: {},
        }),
        answers,
        member: null,
        consents: ["ai_coach", "helper_link"],
      };
    }
    case "mohan": {
      const plan: PlanAnswers = {
        age: { kind: "dob", dob: "1974-03-02" },
        vehicles: ["car"],
        state: "JK",
        aadhaar: "yes",
      };
      return {
        plan,
        case: baseCase("cas_demo_mohan", today, {
          state: "DL_HOLDER",
          display_stage: "DL_HOLDER",
          stage: "S8",
          path: "non_aadhaar_rto",
          classes: [{ class_code: "LMV-NT", status: "dl_issued" }],
          answers: { needs_form_1a: true },
          dl: {
            issued_on: "2016-03-14",
            valid_to_non_transport: addDays(today, 40),
            classes: ["LMV-NT"],
            number_last4: "0829",
            renewal_window_opens: addDays(today, 40 - 365),
            source: "user_entered",
          },
          key_dates: { dl_valid_to: addDays(today, 40), turned_40_on: "2014-03-02" },
        }),
        answers: {},
        member: null,
        consents: [],
      };
    }
    case "rahul": {
      const plan: PlanAnswers = {
        age: { kind: "dob", dob: "2009-03-14" },
        vehicles: ["scooter_50cc"],
        state: "JK",
        aadhaar: "yes",
      };
      const answers: Answers = {
        for_whom: "family",
        member_kind: "child",
        parental_consent: true,
      };
      const member: FamilyMember = {
        member_id: "fam_demo_rahul",
        relation: "child",
        label: "Rahul",
        age_band: "16_17",
        is_minor: true,
        parental_consent: { status: "granted", consent_id: "cns_demo_rahul" },
        created_at: `${addDays(today, -3)}T04:30:00Z`,
      };
      return {
        plan,
        case: baseCase("cas_demo_rahul", today, {
          classes: [{ class_code: "MC50CC", status: "planned" }],
          answers,
          flags: ["for_minor_family_member"],
        }),
        answers,
        member,
        consents: ["ai_coach", "parental_consent"],
      };
    }
    case "dl_holder": {
      const issued = addDays(today, -60);
      return {
        plan: KABIR,
        case: baseCase("cas_demo_kabir_dl", today, {
          state: "DL_HOLDER",
          display_stage: "DL_HOLDER",
          stage: "S8",
          classes: [{ class_code: "MCWG", status: "dl_issued" }],
          answers: KABIR_DONE,
          ll: {
            issued_on: addDays(issued, -45),
            expires_on: addMonths(addDays(issued, -45), 6),
            classes: ["MCWG"],
            source: "user_entered",
          },
          dl: {
            issued_on: issued,
            valid_to_non_transport: "2047-06-14",
            classes: ["MCWG"],
            number_last4: "5521",
            renewal_window_opens: "2046-06-14",
            source: "user_entered",
          },
          key_dates: {
            applied_on: addDays(issued, -47),
            ll_issued_on: addDays(issued, -45),
            dl_test_unlock: addDays(issued, -15),
            slot_date: addDays(issued, -7),
            test_passed_on: addDays(issued, -7),
            approved_on: addDays(issued, -5),
          },
        }),
        answers: KABIR_DONE,
        member: null,
        consents: ["ai_coach"],
      };
    }
  }
}
