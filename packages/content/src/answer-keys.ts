// LL answer keys in the shape the score verifier replays with: @margdarshak/game-core `LlAnswerKey`
// (camelCase, one document per question). Built from the split's server key, so it covers mock
// items too; server-side only, never shipped to a client (GAME_DESIGN §11.10).
import type { LlTopic, SignFamily } from "./schema/common.ts";
import { SIGN_ID_RE } from "./schema/common.ts";
import type { Sign } from "./schema/signs.ts";
import type { ServerKey } from "./split.ts";

export type LlAnswerKeyDoc = {
  /** The item ID; the session item ref is `q:<qref>`. */
  qref: string;
  /** The FSRS card is the concept, so every variant reviews the same card. */
  cardId: string;
  correctOptionId: string;
  topic: LlTopic;
  signFamily: SignFamily | null;
  signId: string | null;
};

const TOPIC_OF_CONCEPT = /^C-(LL[0-4])-\d{3}$/;

/**
 * One key per server-key entry, in its order. The sign is the correct option's sign (a
 * sign-to-meaning stem shows that sign, a meaning-to-sign item has it as the answer), or null for
 * a non-sign question. Throws on a concept outside LL0–LL4 or a sign missing from the catalogue.
 */
export function toLlAnswerKeys(
  serverKey: ServerKey,
  signs: readonly Pick<Sign, "sign_id" | "family">[],
): LlAnswerKeyDoc[] {
  const family = new Map(signs.map((s) => [s.sign_id, s.family]));
  return serverKey.keys.map((k) => {
    const topic = TOPIC_OF_CONCEPT.exec(k.concept_id)?.[1] as LlTopic | undefined;
    if (topic === undefined)
      throw new Error(`${k.item_id}: concept ${k.concept_id} is not LL0–LL4`);
    const ref = k.option_refs[k.correct_option_id];
    const signId = ref !== undefined && SIGN_ID_RE.test(ref) ? ref : null;
    const signFamily = signId === null ? null : family.get(signId);
    if (signFamily === undefined) throw new Error(`${k.item_id}: ${signId} is not in signs.json`);
    return {
      qref: k.item_id,
      cardId: k.concept_id,
      correctOptionId: k.correct_option_id,
      topic,
      signFamily,
      signId,
    };
  });
}
