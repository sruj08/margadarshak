import drills from "@content/catalogue/drills.json";
import enums from "@content/catalogue/enums.json";
import findings from "@content/catalogue/findings.json";
import games from "@content/catalogue/games.json";
import hazardTypes from "@content/catalogue/hazard_types.json";
import rules from "@content/catalogue/rules.json";
import {
  type CatalogueDrill,
  type CatalogueEnum,
  type CatalogueFinding,
  type CatalogueGame,
  type CatalogueHazardType,
  type CatalogueRule,
  type DebriefCatalogue,
  debriefCatalogue,
} from "@margdarshak/game-core/debrief";

/**
 * Server-only: the debrief catalogue (content/catalogue/*.json, ~210 KB) sliced to one game before
 * it reaches the browser, so the debrief page carries a few KB in its RSC payload instead of a
 * catalogue chunk. Import it only from server components (pages).
 */
const FULL: DebriefCatalogue = debriefCatalogue({
  findings: findings as unknown as { findings: CatalogueFinding[] },
  rules: rules as unknown as { rules: CatalogueRule[] },
  drills: drills as unknown as { drills: CatalogueDrill[] },
  games: games as unknown as { games: CatalogueGame[] },
  enums: enums as unknown as { enums: CatalogueEnum[] },
  hazardTypes: hazardTypes as unknown as { hazard_types: CatalogueHazardType[] },
});

export const DEBRIEF_GAMES = FULL.games.map((g) => g.game_id);

/** The catalogue a game's debrief needs: its findings, drills and game row, the rules they cite,
 * the enum labels of their facts, and the hazard-type labels. */
export function catalogueFor(gameId: string): DebriefCatalogue {
  const own = FULL.findings.filter((f) => f.game_id === gameId);
  const ruleIds = new Set(own.flatMap((f) => f.rule_ids));
  const factKeys = new Set(own.flatMap((f) => f.facts.map((k) => k.key)));
  return {
    findings: own,
    rules: FULL.rules.filter((r) => ruleIds.has(r.rule_id)),
    drills: FULL.drills.filter((d) => d.game_id === gameId),
    games: FULL.games.filter((g) => g.game_id === gameId),
    enums: FULL.enums.filter((e) => factKeys.has(e.fact_key)),
    hazardTypes: FULL.hazardTypes.map((h) => ({ hazard_type: h.hazard_type, label: h.label })),
  };
}
