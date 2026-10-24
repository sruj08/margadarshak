// Answer-key handling for the LL bank (GAME_DESIGN §11.10 "no answer keys anywhere"; same
// principle as Nazar hazard windows, NAZAR §3.2). The authored bank in content/questions/ is
// SERVER-SIDE content. A build step splits it into:
//   client         every item without its key, explanation, option refs or concept title
//   practiceKey    keys + explanations for `pool: "practice"` items only; may be served after an
//                  answer (or packed offline for practice), never for mock items
//   serverKey      keys for every item (practice + mock); only the score verifier loads it

import type { LocalizedText } from "./schema/common.ts";
import type { Concept, Item, OptionId, QuestionBankFile } from "./schema/questions.ts";

export type ClientItem = {
  item_id: string;
  concept_id: string;
  topic: QuestionBankFile["topic"];
  form: Item["form"];
  pool: Item["pool"];
  similarity_level: number;
  stem: LocalizedText;
  stem_assets: string[];
  options: { option_id: OptionId; text: LocalizedText; asset_id?: string }[];
};

export type ClientBank = {
  file_kind: "question_bank_client";
  confidence_levels: [50, 75, 100];
  answer_mode: "single_choice";
  items: ClientItem[];
};

export type KeyEntry = {
  item_id: string;
  concept_id: string;
  correct_option_id: OptionId;
  explanation_id: string;
  rule_ids: string[];
};

export type PracticeKey = {
  file_kind: "question_bank_practice_key";
  keys: KeyEntry[];
  explanations: { explanation_id: string; text: LocalizedText }[];
};

export type ServerKey = {
  file_kind: "question_bank_server_key";
  keys: (KeyEntry & {
    pool: Item["pool"];
    option_refs: Partial<Record<OptionId, string>>;
    similarity_level: number;
  })[];
  explanations: { explanation_id: string; text: LocalizedText }[];
};

export type SplitBank = { client: ClientBank; practiceKey: PracticeKey; serverKey: ServerKey };

function clientItem(c: Concept, it: Item): ClientItem {
  return {
    item_id: it.item_id,
    concept_id: c.concept_id,
    topic: c.topic,
    form: it.form,
    pool: it.pool,
    similarity_level: it.similarity.level,
    stem: { en: it.stem.en, hi: it.stem.hi },
    stem_assets: [...it.stem_assets],
    options: it.options.map((o) => ({
      option_id: o.option_id,
      text: { en: o.text.en, hi: o.text.hi },
      ...(o.asset_id ? { asset_id: o.asset_id } : {}),
    })),
  };
}

function keyEntry(c: Concept, it: Item): KeyEntry {
  return {
    item_id: it.item_id,
    concept_id: c.concept_id,
    correct_option_id: it.key.correct_option_id,
    explanation_id: c.explanation.explanation_id,
    rule_ids: [...c.rule_ids],
  };
}

/** Deterministic split of one or more topic files (order preserved). */
export function splitQuestionBank(banks: readonly QuestionBankFile[]): SplitBank {
  const client: ClientItem[] = [];
  const practice: KeyEntry[] = [];
  const server: ServerKey["keys"] = [];
  const practiceEx = new Map<string, LocalizedText>();
  const serverEx = new Map<string, LocalizedText>();
  for (const bank of banks) {
    for (const c of bank.concepts) {
      serverEx.set(c.explanation.explanation_id, c.explanation.text);
      for (const it of c.items) {
        client.push(clientItem(c, it));
        server.push({
          ...keyEntry(c, it),
          pool: it.pool,
          option_refs: { ...(it.key.option_refs ?? {}) },
          similarity_level: it.similarity.level,
        });
        if (it.pool === "practice") {
          practice.push(keyEntry(c, it));
          practiceEx.set(c.explanation.explanation_id, c.explanation.text);
        }
      }
    }
  }
  const toList = (m: Map<string, LocalizedText>) =>
    [...m.entries()].map(([explanation_id, text]) => ({ explanation_id, text }));
  return {
    client: {
      file_kind: "question_bank_client",
      confidence_levels: [50, 75, 100],
      answer_mode: "single_choice",
      items: client,
    },
    practiceKey: {
      file_kind: "question_bank_practice_key",
      keys: practice,
      explanations: toList(practiceEx),
    },
    serverKey: {
      file_kind: "question_bank_server_key",
      keys: server,
      explanations: toList(serverEx),
    },
  };
}
