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
  "ll_test",
  "book_test",
  "track",
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

import type { AppLocale } from "@/i18n/routing";

/**
 * Detects which of the 7 supported Indian languages the user is speaking or typing based on script
 * and distinctive regional vocabulary (Gurmukhi -> pa, Gujarati -> gu, Tamil -> ta, Dogri/Marathi/Hindi Devanagari -> doi/mr/hi, Latin -> en).
 */
export const langOf = (text: string): AppLocale => {
  if (/[\u0A00-\u0A7F]/.test(text)) return "pa";
  if (/[\u0A80-\u0AFF]/.test(text)) return "gu";
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta";
  if (/[\u0900-\u097F]/.test(text)) {
    if (/(तुस|तुंदी|आस्तै|केह्|कुसलै|अज्ज|दस्सो|बनाना ऐ|किन्नी)/.test(text)) return "doi";
    if (/(तुम्ही|तुमचे|आहे|कसे|किती|कागदपत्रे|परवाना|साठी|माझे)/.test(text)) return "mr";
    return "hi";
  }
  return "en";
};

// Specific intents come first; the first match wins.
const RULES: Array<[Intent, RegExp]> = [
  [
    "about_voice",
    /(voice guide|what can you do|kya kar sakte|वॉइस|आवाज़ वाला|क्या कर सकते|केह् करी सकदे|ਆਵਾਜ਼|काय करू शकता|અવાજ|குரல்)/i,
  ],
  [
    "book_test",
    /(book.*(driving|dl|test)|(driving|dl) test.*(book|slot)|test slot|slot book|टेस्ट.*(बुक|स्लॉट)|स्लॉट|ਸਲੌਟ|स्लॉट बुक|સ્લોટ|ஸ்லாட்)/i,
  ],
  [
    "track",
    /(track test|8 track|figure ?8|h track|s track|how.*driving test|ड्राइविंग टेस्ट कैसे|ट्रैक|ਟ੍ਰੈਕ|ट्रॅक|ટ્રેક|டிராக்)/i,
  ],
  [
    "ll_test",
    /(take.*(ll|learner).*test|give.*(ll|learner).*test|ll test de|लर्नर.*टेस्ट दे|ਲਰਨਰ.*ਟੈਸਟ)/i,
  ],
  // Pay and submit on Sarathi are never done by Margdarshak: these go to the hand-off screen.
  ["handoff", /(pay|payment|submit|book|slot|भुगतान|पेमेंट|जमा|बुक|स्लॉट|ਭੁਗਤਾਨ|पैसे|ચૂકવણી|கட்டணம் செலுத்த)/i],
  ["photo", /(photo|फोटो|फ़ोटो|तस्वीर|ਫੋਟੋ|छायाचित्र|ફોટો|புகைப்படம்)/i],
  ["signature", /(signature|दस्तखत|हस्ताक्षर|सिग्नेचर|ਦਸਤਖਤ|सही|સહી|கையொப்பம்)/i],
  [
    "documents",
    /(document|कागज़|कागज|दस्तावेज़|दस्तावेज|डॉक्यूमेंट|ਦਸਤਾਵੇਜ਼|कागदपत्रे|कागदपत्र|દસ્તાવેજ|ஆவணங்கள்|ஆவணம்)/i,
  ],
  ["mock_test", /(mock|ll test|exam|मॉक|परीक्षा|ਮੌਕ|चाचणी|મોક ટેસ્ટ|மாதிரி தேர்வு)/i],
  ["stopping", /(stopping|brake|distance|ब्रेक|दूरी|ਬ੍ਰੇਕ|ब्रेकिंग|બ્રેક|நிறுத்தும் தூரம்)/i],
  ["signs", /(road sign|signs?\b|nazar|साइन|संकेत|नज़र|निशान|ਸੰਕੇਤ|चिन्हे|ચિહ્નો|சாலை चिन्ह|அடையாளங்கள்)/i],
  ["readiness", /(readiness|am i ready|ready for|रेडी|तैयार हूँ|ਤਿਆਰ|तयार|તૈયાર|தயாரா)/i],
  ["privacy", /(privacy|my data|consent|प्राइवेसी|गोपनीय|डेटा|ਪ੍ਰਾਈਵੇਸੀ|गोपनीयता|ગોપનીયતા|தனியுரிமை)/i],
  ["grievance", /(complain|grievance|शिकायत|ਸ਼ਿਕਾਇਤ|तक्रार|ફરિયાદ|புகார்)/i],
  ["accessibility", /(accessib|large text|font size|सुलभ|बड़े अक्षर|ਵੱਡੇ ਅੱਖਰ|मोठे अक्षर|મોટા અક્ષરો)/i],
  ["services", /(all services|services|सेवाएं|सेवाएँ|सारी सेवा|ਸੇਵਾਵਾਂ|सेवा|સેવાઓ|சேவைகள்)/i],
  [
    "apply",
    /(fill (the |my )?form|start (my )?application|apply now|फ़ॉर्म भर|फॉर्म भर|ਫਾਰਮ ਭਰੋ|अर्ज करा|ફોર્મ ભરો|விண்ணப்பிக்க)/i,
  ],
  [
    "family",
    /(papa|father|dad|mummy|mother|maa|beta|beti|son|daughter|child|family|पापा|पिता|माँ|मम्मी|बेटा|बेटी|बच्चा|परिवार|ਪਰਿਵਾਰ|कुटुंब|পরিবার|પરિવાર|குடும்பம்)/i,
  ],
  [
    "fees",
    /(fee|fees|cost|price|kitna|kitni|kharcha|charge|फ़ीस|फीस|कितना|कितनी|खर्च|किन्नी|ਫੀਸ|ਕਿੰਨੀ|फी|किती|ફી|કેટલી|கட்டணம்|எவ்வளவு)/i,
  ],
  [
    "renew",
    /(renew|expired|expire|duplicate|lost|address change|रिन्यू|नवीनीकरण|डुप्लीकेट|खो|ਨਵੀਨੀਕਰਨ|नूतनीकरण|રિન્યુ|புதுப்பிக்க)/i,
  ],
  [
    "practise",
    /(practi[cs]e|mock|question|quiz|signs?|nazar|prepare|tayari|taiyari|तैयारी|अभ्यास|प्रैक्टिस|सवाल|ਅਭਿਆस|सराव|ਪ੍ਰੈਕਟਿਸ|પ્રેક્ટિસ|பயிற்சி)/i,
  ],
  ["check", /(status|application|where am i|kahan|track|स्टेटस|एप्लीकेशन|कहाँ|ਕਿੱਥੇ|स्थिती|સ્થિતિ|நிலை)/i],
  [
    "plan",
    /(licen[cs]e|ll\b|dl\b|learner|first|apply|banwana|banana|chahiye|लाइसेंस|लर्नर|अप्लाई|बनवाना|चाहिए|बनाना ऐ|ਲਾਇਸੰਸ|लायसन्स|परवाना|લાઇસન્સ|உரிமம்)/i,
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
  ll_test: "/test/ll",
  book_test: "/dl/apply",
  track: "/dl/track",
  signs: "/learn/review?topic=LL1",
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
