import illustrations from "@content/catalogue/illustrations.json";
import signs from "@content/catalogue/signs.json";
import client from "@content/generated/ll-bank.client.json";
import practiceKey from "@content/generated/ll-bank.practice-key.json";
import { type AppLocale, isAppLocale } from "@/i18n/routing";
import {
  type Bank,
  type BankItem,
  type BankVisual,
  isLlTopic,
  type LlTopicId,
  type PracticeKey,
} from "./bank-types";

/**
 * Server-side (and test-side) builder of the locale bank. Never imported by a client component:
 * the raw files are 400 KB; the learn data routes serve the trimmed result as JSON.
 */

type Locale = AppLocale;
type Loc = { en: string; hi: string } & Partial<Record<Locale, string>>;

function pickLoc(loc: Loc, locale: Locale): string {
  return loc[locale] ?? (locale === "hi" || locale === "doi" || locale === "mr" ? loc.hi : loc.en);
}

interface RawSign {
  sign_id: string;
  family: string;
  shape: string;
  colour_scheme: string;
  alt: Loc;
}
interface RawIllustration {
  illustration_id: string;
  alt: Loc;
}
interface RawOption {
  option_id: string;
  text: Loc;
  asset_id?: string;
}
interface RawItem {
  item_id: string;
  concept_id: string;
  topic: string;
  form: string;
  pool: string;
  stem: Loc;
  stem_assets: string[];
  options: RawOption[];
}

const SIGNS = new Map(
  (signs as unknown as { signs: RawSign[] }).signs.map((s) => [s.sign_id, s] as const),
);
const ILLUSTRATIONS = new Map(
  (illustrations as unknown as { illustrations: RawIllustration[] }).illustrations.map(
    (i) => [i.illustration_id, i] as const,
  ),
);

function visual(id: string, locale: Locale): BankVisual | null {
  const s = SIGNS.get(id);
  if (s)
    return {
      id,
      kind: "sign",
      shape: s.shape,
      scheme: s.colour_scheme,
      family: s.family,
      alt: pickLoc(s.alt, locale),
    };
  const i = ILLUSTRATIONS.get(id);
  if (i)
    return {
      id,
      kind: "illustration",
      shape: "picture",
      scheme: "",
      family: null,
      alt: pickLoc(i.alt, locale),
    };
  return null;
}

export function buildBank(locale: Locale): Bank {
  const items: BankItem[] = [];
  const concepts: Record<LlTopicId, Set<string>> = {
    LL1: new Set(),
    LL2: new Set(),
    LL3: new Set(),
    LL4: new Set(),
  };
  for (const raw of (client as unknown as { items: RawItem[] }).items) {
    if (!isLlTopic(raw.topic)) continue;
    concepts[raw.topic].add(raw.concept_id);
    items.push({
      id: raw.item_id,
      concept: raw.concept_id,
      topic: raw.topic,
      form: raw.form,
      pool: raw.pool === "mock" ? "mock" : "practice",
      stem: pickLoc(raw.stem, locale),
      visuals: raw.stem_assets
        .map((a) => visual(a, locale))
        .filter((v): v is BankVisual => v !== null),
      options: raw.options.map((o) => ({
        id: o.option_id,
        text: pickLoc(o.text, locale),
        visual: o.asset_id ? visual(o.asset_id, locale) : null,
      })),
    });
  }
  return {
    locale,
    items,
    conceptCounts: {
      LL1: concepts.LL1.size,
      LL2: concepts.LL2.size,
      LL3: concepts.LL3.size,
      LL4: concepts.LL4.size,
    },
  };
}

interface RawKey {
  item_id: string;
  correct_option_id: string;
  explanation_id: string | null;
  rule_ids: string[];
}

export function buildPracticeKey(locale: Locale): PracticeKey {
  const raw = practiceKey as unknown as {
    keys: RawKey[];
    explanations: { explanation_id: string; text: Loc }[];
  };
  const expl = new Map(
    raw.explanations.map((e) => [e.explanation_id, pickLoc(e.text, locale)] as const),
  );
  const out: PracticeKey = {};
  for (const k of raw.keys) {
    out[k.item_id] = {
      correct: k.correct_option_id,
      explanation: k.explanation_id ? (expl.get(k.explanation_id) ?? null) : null,
      ruleIds: k.rule_ids,
    };
  }
  return out;
}

export function isBankLocale(v: string): v is Locale {
  return isAppLocale(v);
}
