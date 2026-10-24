import { describe, expect, it } from "vitest";
import {
  type Answers,
  applyAnswer,
  decisionScreens,
  doneCount,
  type FormContext,
  fieldCounts,
  firstOpen,
  flow,
  nextInTask,
  nextTask,
  positionInTask,
  prevInTask,
  question,
  taskStatus,
  validate,
} from "./form-engine";

const aadhaar: FormContext = {
  path: "aadhaar_contactless",
  minor: false,
  form1aNeeded: false,
  offices: [{ id: "jk-rto-jammu", name: "RTO Jammu" }],
  documentsDone: false,
};
const nonAadhaar: FormContext = { ...aadhaar, path: "non_aadhaar" };
const minor: FormContext = { ...aadhaar, minor: true };

const ids = (a: Answers, c: FormContext) => flow(a, c).map((q) => q.id);

describe("form engine (MD-110)", () => {
  it("Kabir (Aadhaar path, adult) sees at most 6 decision screens", () => {
    const a: Answers = { aadhaar_address_match: "yes" };
    expect(ids(a, aadhaar)).toEqual([
      "for_whom",
      "category",
      "licence_held",
      "mobile_linked",
      "aadhaar_relation_line",
      "form1",
    ]);
    expect(decisionScreens(a, aadhaar)).toBeLessThanOrEqual(6);
  });

  it("carried answers (classes, Aadhaar address, country) are never asked in the flow", () => {
    const all = ids({}, aadhaar);
    expect(all).not.toContain("classes");
    expect(all).not.toContain("aadhaar_address_match");
    expect(all).not.toContain("born_in_india");
  });

  it("the non-Aadhaar path adds the office and the typed details (vault)", () => {
    const list = ids({ aadhaar_address_match: "no" }, nonAadhaar);
    expect(list).toContain("office");
    expect(list).toContain("personal");
    expect(question("personal")?.vault).toBe(true);
    expect(fieldCounts({}, nonAadhaar).typed).toBe(3);
    expect(fieldCounts({}, aadhaar).typed).toBe(0);
  });

  it("no Aadhaar: no mobile-link or relation-line questions", () => {
    const list = ids({ aadhaar_address_match: "none" }, nonAadhaar);
    expect(list).not.toContain("mobile_linked");
    expect(list).not.toContain("aadhaar_relation_line");
  });

  it("family mode: member question, and parental consent for a minor (D-13 revised)", () => {
    expect(ids({ for_whom: "family" }, minor)).toEqual(
      expect.arrayContaining(["member_kind", "parental_consent"]),
    );
    expect(ids({ for_whom: "family" }, aadhaar)).not.toContain("parental_consent");
    expect(ids({ for_whom: "self" }, aadhaar)).not.toContain("member_kind");
  });

  it("Form 1A is asked only when needed (40+ or transport)", () => {
    expect(ids({}, aadhaar)).not.toContain("form1a");
    expect(ids({}, { ...aadhaar, form1aNeeded: true })).toContain("form1a");
  });

  it("navigates within a task, with back and position in steps", () => {
    const a: Answers = { for_whom: "self" };
    expect(nextInTask("for_whom", a, aadhaar)).toBe("category");
    expect(nextInTask("category", a, aadhaar)).toBeNull();
    expect(prevInTask("category", a, aadhaar)).toBe("for_whom");
    expect(prevInTask("for_whom", a, aadhaar)).toBeNull();
    expect(positionInTask("category", a, aadhaar)).toEqual({ i: 2, n: 2 });
  });

  it("task status moves from not started to done; check is locked until the rest are done", () => {
    let a: Answers = {};
    expect(taskStatus("about", a, aadhaar)).toBe("not_started");
    expect(taskStatus("check", a, aadhaar)).toBe("locked");
    a = { for_whom: "self" };
    expect(taskStatus("about", a, aadhaar)).toBe("in_progress");
    expect(firstOpen("about", a, aadhaar)).toBe("category");
    a = {
      ...a,
      category: "general",
      licence_held: "none",
      mobile_linked: "yes",
      aadhaar_relation_line: "yes",
      form1: true,
    };
    const docs = { ...aadhaar, documentsDone: true };
    expect(nextTask(a, docs)).toBe("check");
    expect(taskStatus("check", a, docs)).toBe("not_started");
    expect(taskStatus("check", { ...a, check_confirmed: true }, docs)).toBe("done");
    expect(doneCount({ ...a, check_confirmed: true }, docs)).toBe(6);
  });

  it("text questions are done only when every field is in the vault", () => {
    const q = question("personal");
    expect(q).toBeDefined();
    const a: Answers = { aadhaar_address_match: "no" };
    expect(taskStatus("route", a, nonAadhaar, { full_name: "A" })).not.toBe("done");
  });

  it("validates choice, consent and text, and rejects identity numbers (EC-20)", () => {
    const radio = question("category");
    const consent = question("parental_consent");
    const text = question("personal");
    if (!radio || !consent || !text) throw new Error("missing questions");
    expect(validate(radio, undefined)).toBe("choose_one");
    expect(validate(radio, "general")).toBeNull();
    expect(validate(consent, false)).toBe("agree_required");
    expect(validate(consent, true)).toBeNull();
    expect(validate(text, null, { full_name: "Tanvi", relative_name: "", home: "Jammu" })).toBe(
      "fill_all",
    );
    const bad = (s: string) => /\d{12}/.test(s);
    expect(
      validate(
        text,
        null,
        { full_name: "Tanvi", relative_name: "223456789127", home: "Jammu" },
        bad,
      ),
    ).toBe("no_identity_numbers");
  });

  it("changing an answer drops answers that no longer apply, and asks to confirm again", () => {
    const a: Answers = { for_whom: "family", member_kind: "child", check_confirmed: true };
    const next = applyAnswer(a, "for_whom", "self", aadhaar);
    expect(next["member_kind"]).toBeUndefined();
    expect(next["check_confirmed"]).toBeUndefined();
  });

  it("answer keys never use the server's prohibited names (name*, relation*, address*, otp, aadhaar number)", () => {
    const prohibited =
      /(aadhaar_?(no|num|number)|otp|captcha|password|biometric|^name|^relation|^address)/i;
    for (const q of flow(
      { for_whom: "family", aadhaar_address_match: "no" },
      { ...nonAadhaar, minor: true, form1aNeeded: true },
    )) {
      expect(prohibited.test(q.id), q.id).toBe(false);
    }
  });
});
