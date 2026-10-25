import type ai from "./messages/en/ai.json";
import type curator from "./messages/en/curator.json";
import type flow from "./messages/en/flow.json";
import type games from "./messages/en/games.json";
import type learnHub from "./messages/en/learnHub.json";
import type llSim from "./messages/en/llSim.json";
import type me from "./messages/en/me.json";
import type nazar from "./messages/en/nazar.json";
import type sims from "./messages/en/sims.json";
import type study from "./messages/en/study.json";
import type messages from "./messages/en.json";
import type { formats } from "./src/i18n/formats";
import type { routing } from "./src/i18n/routing";

/** The P2 namespace files (src/i18n/messages.ts), typed from the English copy like en.json. */
interface P2Messages {
  games: typeof games;
  nazar: typeof nazar;
  learnHub: typeof learnHub;
  llSim: typeof llSim;
  sims: typeof sims;
  me: typeof me;
  study: typeof study;
  curator: typeof curator;
  ai: typeof ai;
  flow: typeof flow;
}

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages & P2Messages;
    Formats: typeof formats;
  }
}
