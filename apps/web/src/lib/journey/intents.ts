/**
 * "Tell us" keyword router (MD-119 until the voice guide ships in P3): free text (already redacted
 * on the device) to one of a closed set of intents, in English, Hindi and Hinglish. No AI, no
 * network; the same intent IDs the voice guide will use.
 */
export type Intent = "plan" | "fees" | "practise" | "renew" | "family" | "check" | "help";

const RULES: Array<[Intent, RegExp]> = [
  [
    "family",
    /(papa|father|dad|mummy|mother|maa|beta|beti|son|daughter|child|family|पापा|पिता|माँ|मम्मी|बेटा|बेटी|बच्चा|परिवार)/i,
  ],
  ["fees", /(fee|fees|cost|price|kitna|kitni|kharcha|charge|फ़ीस|फीस|कितना|कितनी|खर्च)/i],
  ["renew", /(renew|expired|expire|duplicate|lost|address change|रिन्यू|नवीनीकरण|डुप्लीकेट|खो)/i],
  [
    "practise",
    /(practi[cs]e|mock|question|quiz|signs?|nazar|prepare|tayari|taiyari|तैयारी|अभ्यास|प्रैक्टिस|सवाल)/i,
  ],
  ["check", /(status|application|where am i|kahan|track|स्टेटस|एप्लीकेशन|कहाँ)/i],
  [
    "plan",
    /(licen[cs]e|ll\b|dl\b|learner|first|apply|banwana|banana|chahiye|लाइसेंस|लर्नर|अप्लाई|बनवाना|चाहिए)/i,
  ],
];

export function routeIntent(text: string): Intent {
  for (const [intent, re] of RULES) if (re.test(text)) return intent;
  return "help";
}

export const INTENT_HREF: Record<Intent, string> = {
  plan: "/plan",
  fees: "/plan",
  practise: "/learn",
  renew: "/services/renew",
  family: "/services/family",
  check: "/licence",
  help: "/help",
};
