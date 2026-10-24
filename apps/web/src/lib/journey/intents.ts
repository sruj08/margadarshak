/**
 * "Tell us" keyword router (MD-119 until the voice guide ships in P3): free text (already redacted
 * on the device) to one of a closed set of intents, in English, Hindi and Hinglish. No AI, no
 * network; the same intent IDs the voice guide will use.
 */
export const INTENTS = [
  "plan",
  "fees",
  "apply",
  "documents",
  "photo",
  "signature",
  "practise",
  "mock_test",
  "signs",
  "stopping",
  "readiness",
  "check",
  "renew",
  "family",
  "services",
  "privacy",
  "grievance",
  "accessibility",
  "handoff",
  "about_voice",
  "help",
] as const;
export type Intent = (typeof INTENTS)[number];

/** Devanagari in the text means the person is speaking or typing Hindi; anything else is English. */
export const langOf = (text: string): "hi" | "en" => (/[\u0900-\u097F]/.test(text) ? "hi" : "en");

// Specific intents come first; the first match wins.
const RULES: Array<[Intent, RegExp]> = [
  ["about_voice", /(voice guide|what can you do|kya kar sakte|वॉइस|आवाज़ वाला|क्या कर सकते)/i],
  // Pay, submit and book are never done by Margdarshak: these go to the hand-off screen.
  ["handoff", /(pay|payment|submit|book|slot|भुगतान|पेमेंट|जमा|बुक|स्लॉट)/i],
  ["photo", /(photo|फोटो|फ़ोटो|तस्वीर)/i],
  ["signature", /(signature|दस्तखत|हस्ताक्षर|सिग्नेचर)/i],
  ["documents", /(document|कागज़|कागज|दस्तावेज़|दस्तावेज|डॉक्यूमेंट)/i],
  ["mock_test", /(mock|ll test|exam|मॉक|परीक्षा)/i],
  ["stopping", /(stopping|brake|distance|ब्रेक|दूरी)/i],
  ["signs", /(road sign|signs?\b|nazar|साइन|संकेत|नज़र|निशान)/i],
  ["readiness", /(readiness|am i ready|ready for|रेडी|तैयार हूँ)/i],
  ["privacy", /(privacy|my data|consent|प्राइवेसी|गोपनीय|डेटा)/i],
  ["grievance", /(complain|grievance|शिकायत)/i],
  ["accessibility", /(accessib|large text|font size|सुलभ|बड़े अक्षर)/i],
  ["services", /(all services|services|सेवाएं|सेवाएँ|सारी सेवा)/i],
  ["apply", /(fill (the |my )?form|start (my )?application|apply now|फ़ॉर्म भर|फॉर्म भर)/i],
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

/** Every href is a live route. `null` means the answer stays on the sheet (no navigation). */
export const INTENT_HREF: Record<Intent, string | null> = {
  plan: "/plan",
  fees: "/plan",
  apply: "/apply",
  documents: "/apply/documents",
  photo: "/apply/photo",
  signature: "/apply/signature",
  practise: "/learn",
  mock_test: "/learn/practise/ll-sim",
  signs: "/learn/practise/nazar",
  stopping: "/learn/practise/stopping-distance",
  readiness: "/learn/readiness",
  check: "/licence",
  renew: "/services/renew",
  family: "/services/family",
  services: "/services",
  privacy: "/privacy",
  grievance: "/grievance",
  accessibility: "/accessibility",
  handoff: "/apply/handoff",
  about_voice: null,
  help: "/help",
};
