// Anti-dark-pattern lint spec (GAMIFICATION_ENGINE §12): the 13 patterns of
// the CCPA Guidelines for Prevention and Regulation of Dark Patterns (notified
// 30 Nov 2023) plus five of our own, as data. scripts/lint_patterns.mjs
// (MD-235: copy phrases, DP-13 APK links and the JSX rules for DP-01, DP-04
// and DP-06) consumes this; nothing here runs a check itself. A PR failing any DP lint can't merge; waivers need the product
// lead's sign-off in the PR and a CHANGELOG line.

export type Enforcement = "copy" | "component" | "e2e" | "review" | "unit";

export interface CopyRule {
  /** Locale → banned phrase patterns (glob-ish: `*` matches any words). */
  readonly banned?: Readonly<Record<string, readonly string[]>>;
  /** When a banned phrase is allowed: the string must carry this source key. */
  readonly unlessSourceKey?: string;
}

export interface PatternRule {
  readonly id: `DP-${string}`;
  /** CCPA pattern name, or our own pattern name for DP-14..DP-18. */
  readonly pattern: string;
  readonly origin: "ccpa_2023" | "margdarshak";
  /** Our rule, in one sentence. */
  readonly rule: string;
  /** What a check should detect. */
  readonly detect: readonly string[];
  readonly enforcement: readonly Enforcement[];
  /** Automated in Phase 1–2 (§15: DP-01, 03, 04, 06, 08, 10, 13, 18); others are review-only for now. */
  readonly automatedPhase12: boolean;
  readonly copy?: CopyRule;
  readonly example: { readonly violation: string; readonly compliant: string };
}

export const patternLintSpec: readonly PatternRule[] = Object.freeze([
  {
    id: "DP-01",
    pattern: "False urgency",
    origin: "ccpa_2023",
    rule: "Countdowns only from the rules engine (LL expiry, real test date); no scarcity claims unless from a moderated, timestamped Live Intel report.",
    detect: [
      "<Countdown> without a sourceRuleId prop",
      "copy with urgency or scarcity phrases and no source key",
    ],
    enforcement: ["component", "copy"],
    automatedPhase12: true,
    copy: {
      banned: { en: ["hurry", "only * left", "last chance", "ends soon"], hi: ["जल्दी करें"] },
      unlessSourceKey: "sourceRuleId",
    },
    example: {
      violation: "Hurry! Only 3 slots left today.",
      compliant: "Your LL expires on {date} (from your state's rule pack).",
    },
  },
  {
    id: "DP-02",
    pattern: "Basket sneaking",
    origin: "ccpa_2023",
    rule: "Nothing is added to any selection without an explicit tap; school bookings show the full total (incl. vehicle) before the tap.",
    detect: ["pre-selected add-ons", "booking total that differs from the sum of line items"],
    enforcement: ["e2e"],
    automatedPhase12: false,
    example: {
      violation: "A vehicle-hire add-on ticked by default in a school booking.",
      compliant: "Every add-on starts unticked; the total equals the visible line items.",
    },
  },
  {
    id: "DP-03",
    pattern: "Confirm shaming",
    origin: "ccpa_2023",
    rule: 'Decline buttons are neutral ("Not now" / "अभी नहीं").',
    detect: ["decline-key strings that shame or guilt the user"],
    enforcement: ["copy", "review"],
    automatedPhase12: true,
    copy: { banned: { en: ["no, i like *", "no thanks, i *", "i don't care about *"] } },
    example: { violation: "No, I like paying agents", compliant: "Not now" },
  },
  {
    id: "DP-04",
    pattern: "Forced action",
    origin: "ccpa_2023",
    rule: "Games work without camera, contacts, squads or sharing; sharing never unlocks content or earns XP.",
    detect: [
      "a requiresShare prop on any component",
      "a game that can't complete with camera denied and no account",
    ],
    enforcement: ["e2e", "component"],
    automatedPhase12: true,
    example: {
      violation: "Share with 3 friends to unlock the next level.",
      compliant: "Next level unlocked. Share is optional and changes nothing.",
    },
  },
  {
    id: "DP-05",
    pattern: "Subscription trap",
    origin: "ccpa_2023",
    rule: "No subscription in the MVP; any future school Pro tier cancels in one tap from the same screen.",
    detect: ["cancellation flows longer than one tap or on another screen"],
    enforcement: ["review", "e2e"],
    automatedPhase12: false,
    example: {
      violation: "Cancel by emailing support from the website.",
      compliant: "Cancel button next to the plan, one tap.",
    },
  },
  {
    id: "DP-06",
    pattern: "Interface interference",
    origin: "ccpa_2023",
    rule: '"Book anyway" visible whenever Readiness < 85; no pre-ticked consents; decline as visible as accept.',
    detect: [
      "book-anyway not visible at Readiness 0, 60 or 84",
      "<Checkbox defaultChecked> on a consent screen",
    ],
    enforcement: ["e2e", "component"],
    automatedPhase12: true,
    example: {
      violation: "Book button greyed out until Readiness reaches 85.",
      compliant: '"Ready, book the test" at 85, and "Book anyway" always visible.',
    },
  },
  {
    id: "DP-07",
    pattern: "Bait and switch",
    origin: "ccpa_2023",
    rule: "Badge criteria shown before starting; scores shown exactly as computed.",
    detect: [
      "badge copy not generated from the criterion config",
      "displayed score differs from the computed one",
    ],
    enforcement: ["review", "unit"],
    automatedPhase12: false,
    example: {
      violation: "Badge criteria revealed only after the attempt.",
      compliant: '"Nazar 90: score 90+ over 3 counted mocks" shown on the badge before play.',
    },
  },
  {
    id: "DP-08",
    pattern: "Drip pricing",
    origin: "ccpa_2023",
    rule: "Government fees from fees.json shown in full up front, never as literals; school prices include everything.",
    detect: [
      "rupee literals in UI strings and prompts (D-06)",
      "fee card total not equal to the sum of lines",
    ],
    enforcement: ["copy", "e2e"],
    automatedPhase12: true,
    example: {
      violation: "A card fee that appears only on the payment step.",
      compliant:
        "Every fee line from fees.json shown together, with the total, before the first step.",
    },
  },
  {
    id: "DP-09",
    pattern: "Disguised advertisement",
    origin: "ccpa_2023",
    rule: 'Paid school listings labelled "Sponsored" / "प्रायोजित".',
    detect: ["<SchoolCard paid> rendered without the sponsored label"],
    enforcement: ["component"],
    automatedPhase12: false,
    example: {
      violation: "A paid listing styled like the others.",
      compliant: 'A paid listing with a "Sponsored" label.',
    },
  },
  {
    id: "DP-10",
    pattern: "Nagging",
    origin: "ccpa_2023",
    rule: "≤ 1 push or WhatsApp per day tied to a real deadline; quiet hours 22:00–07:00 IST; one-tap opt-out per channel; STOP honoured.",
    detect: [
      "more than one notification per user per IST day",
      "a notification in quiet hours",
      "a notification triggered by a streak alone",
    ],
    enforcement: ["unit"],
    automatedPhase12: true,
    example: {
      violation: '"Your streak misses you!" push every evening.',
      compliant: "One reminder the day before the real test date.",
    },
  },
  {
    id: "DP-11",
    pattern: "Trick question",
    origin: "ccpa_2023",
    rule: "Consent copy is a plain yes/no in the user's language; no double negatives.",
    detect: ['negation pairs in consent strings ("don\'t not", "न… नहीं…")'],
    enforcement: ["copy", "review"],
    automatedPhase12: false,
    copy: { banned: { en: ["don't not *", "do not uncheck *"] } },
    example: {
      violation: "Untick this if you don't want us not to send tips.",
      compliant: "Send me tips about my test? Yes / No",
    },
  },
  {
    id: "DP-12",
    pattern: "SaaS billing",
    origin: "ccpa_2023",
    rule: "No recurring billing in the MVP; any future billing shows the renewal date and amount before each charge.",
    detect: ["a charge without a prior renewal notice"],
    enforcement: ["review"],
    automatedPhase12: false,
    example: {
      violation: "Silent auto-renewal.",
      compliant: '"Renews on {date} for {amount}" shown before each charge.',
    },
  },
  {
    id: "DP-13",
    pattern: "Rogue malware",
    origin: "ccpa_2023",
    rule: "No APK links anywhere; share links only on our domain.",
    detect: ["links ending in .apk", "links to non-allowlisted domains"],
    enforcement: ["copy", "e2e"],
    automatedPhase12: true,
    example: {
      violation: "Download our app: example.com/margdarshak.apk",
      compliant: "Open in your browser on our domain; no install needed.",
    },
  },
  {
    id: "DP-14",
    pattern: "Variable-ratio rewards",
    origin: "margdarshak",
    rule: "No loot boxes, random XP or mystery rewards; variety only in content.",
    detect: ["randomness in XP or reward code", "XP that isn't a pure function of the session"],
    enforcement: ["review", "unit"],
    automatedPhase12: false,
    example: {
      violation: "Spin the wheel for bonus XP!",
      compliant: "New clip types unlocked this week.",
    },
  },
  {
    id: "DP-15",
    pattern: "Public loss and comparison pushes",
    origin: "margdarshak",
    rule: 'No "your friend beat you", no public fail states.',
    detect: ["copy comparing the user to a named person", "a failure shown to anyone but the user"],
    enforcement: ["copy", "review"],
    automatedPhase12: false,
    copy: { banned: { en: ["* beat you", "* is ahead of you", "you lost to *"] } },
    example: { violation: "Rahul beat your score!", compliant: "You spotted 7 of 10 hazards." },
  },
  {
    id: "DP-16",
    pattern: "Money for learning",
    origin: "margdarshak",
    rule: "No cash, cash-back, coupons or redeemable prizes (also the Online Gaming Act 2025).",
    detect: ["prizes, cash-back, coupons or stakes tied to learning or games"],
    enforcement: ["review"],
    automatedPhase12: false,
    example: {
      violation: "Top scorer this week wins a voucher.",
      compliant: "Badges only, never redeemable.",
    },
  },
  {
    id: "DP-17",
    pattern: "Fear content",
    origin: "margdarshak",
    rule: "No gore, death splash screens or injury imagery.",
    detect: ["banned fear words in copy", "injury imagery in assets"],
    enforcement: ["copy", "review"],
    automatedPhase12: false,
    copy: { banned: { en: ["you would crash", "you will die", "blood", "gore"] } },
    example: {
      violation: "A crash splash screen after a missed hazard.",
      compliant: '"The hazard started 1.4 s before your tap."',
    },
  },
  {
    id: "DP-18",
    pattern: "Minors",
    origin: "margdarshak",
    rule: "No behavioural tracking, profiling, targeted ads or marketing on a minor's data; squads, pair mode and share cards only with the parent's consent (D-13 revised).",
    detect: [
      "family-mode profile reaching squad, pair or share actions without the parent-consent step",
      "analytics, ads or marketing events carrying a minor's profile",
    ],
    enforcement: ["e2e"],
    automatedPhase12: true,
    example: {
      violation: "A family-mode profile can share a card without the parent's consent.",
      compliant: "The share action shows the parent-consent step until the parent consents.",
    },
  },
] satisfies readonly PatternRule[]);

/** Looks up a rule by ID. */
export function patternRule(id: string): PatternRule | undefined {
  return patternLintSpec.find((r) => r.id === id);
}
