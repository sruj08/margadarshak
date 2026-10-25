"use client";

/**
 * Browser speech for the coach: speech synthesis reads a turn aloud and speech recognition turns
 * the learner's spoken reply into text, both in the UI language (hi-IN, en-IN). Recognition is the
 * browser's own service (Chrome sends the audio to its speech service; we never receive audio).
 * Neither is required: the text is always on screen and a reply can always be typed.
 */

export type SpeechLang = "en" | "hi" | "doi" | "pa" | "mr" | "gu" | "ta";

export const BCP47: Record<SpeechLang, string> = {
  en: "en-IN",
  hi: "hi-IN",
  doi: "hi-IN", // Dogri uses Devanagari / hi-IN neural speech synthesis
  pa: "pa-IN",
  mr: "mr-IN",
  gu: "gu-IN",
  ta: "ta-IN",
};

export function toSpeechLang(locale: string | undefined | null): SpeechLang {
  const base = locale?.toLowerCase().replace("_", "-").split("-")[0];
  if (
    base === "hi" ||
    base === "doi" ||
    base === "pa" ||
    base === "mr" ||
    base === "gu" ||
    base === "ta"
  ) {
    return base;
  }
  return "en";
}

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Curated list of authentic Indian neural/natural voice names across Windows (Microsoft Natural),
 * Chrome/Android (Google India), and macOS/iOS (Apple India).
 */
const PREFERRED_INDIAN_VOICE_KEYWORDS: Record<SpeechLang, string[]> = {
  en: [
    "neerja",
    "prabhat",
    "heera",
    "ravi",
    "rishi",
    "veena",
    "sangeeta",
    "google english (india)",
    "india",
  ],
  hi: [
    "swara",
    "madhur",
    "hemant",
    "kalpana",
    "lekha",
    "kiyara",
    "neel",
    "google हिन्दी",
    "google hindi",
  ],
  doi: ["swara", "madhur", "hemant", "kalpana", "lekha", "google हिन्दी", "google hindi"],
  pa: ["ojas", "noor", "google ਪੰਜਾਬੀ", "punjabi", "swara", "madhur"],
  mr: ["aarohi", "manohar", "google मराठी", "marathi", "swara", "madhur"],
  gu: ["dhwani", "niranjan", "google ગુજરાતી", "gujarati", "swara", "madhur"],
  ta: ["pallavi", "valluvar", "kanishaa", "vani", "google தமிழ்", "tamil", "swara", "neerja"],
};

let voicesPrewarmed = false;
function ensureVoicesPrewarmed(): void {
  if (voicesPrewarmed || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  voicesPrewarmed = true;
  try {
    speechSynthesis.getVoices();
    if ("addEventListener" in speechSynthesis) {
      speechSynthesis.addEventListener("voiceschanged", () => {
        speechSynthesis.getVoices();
      });
    }
  } catch {
    // Ignore in environments where speechSynthesis is stubbed
  }
}

const GURMUKHI_SPECIAL_MAP: Record<number, string> = {
  2672: "\u0902", // Tippi -> Anusvara
  2673: "", // Addak -> skip gemination mark
  2674: "\u0905", // Iri -> A
  2675: "\u0909", // Ura -> U
  2676: "एक ओंकार",
};

function transliterateIndicChar(ch: string): string {
  const code = ch.charCodeAt(0);
  // Gurmukhi block (U+0A00..U+0A7F) -> Devanagari (U+0900..U+097F)
  if (code >= 0x0a01 && code <= 0x0a75) {
    if (code in GURMUKHI_SPECIAL_MAP) return GURMUKHI_SPECIAL_MAP[code] ?? "";
    return code <= 0x0a6f ? String.fromCharCode(code - 0x0100) : ch;
  }
  // Gujarati block (U+0A80..U+0AFF) -> Devanagari (U+0900..U+097F)
  if (code >= 0x0a81 && code <= 0x0aef) {
    return String.fromCharCode(code - 0x0180);
  }
  // Tamil block (U+0B80..U+0BFF) -> Devanagari (U+0900..U+097F)
  if (code >= 0x0b82 && code <= 0x0bef) {
    return code === 0x0bd7 ? "\u094c" : String.fromCharCode(code - 0x0280);
  }
  return ch;
}

/**
 * When a regional Indic language (`pa`, `gu`, `ta`) falls back to a Devanagari
 * (`hi-IN` / `mr-IN`) OS voice because the device lacks a native Gurmukhi, Gujarati,
 * or Tamil voice pack, browser TTS engines otherwise skip non-Devanagari characters
 * in silence. Transliterating the ISCII-aligned Unicode blocks (`0x0A00..0x0BFF`)
 * into Devanagari (`0x0900..0x097F`) lets the Indian Hindi voice read the text
 * phonetically aloud.
 */
export function adaptScriptForVoice(
  text: string,
  lang: SpeechLang,
  voiceLang?: string | null,
): string {
  if (!text || (lang !== "pa" && lang !== "gu" && lang !== "ta")) {
    return text;
  }
  const normVoice = (voiceLang ?? "").toLowerCase().replace("_", "-");
  const isDevanagariVoice = normVoice.startsWith("hi") || normVoice.startsWith("mr");
  if (!isDevanagariVoice) {
    return text;
  }

  const normalizedGurmukhi = text
    .replace(/\u0A72\u0A3F/g, "\u0907")
    .replace(/\u0A72\u0A40/g, "\u0908")
    .replace(/\u0A72\u0A47/g, "\u090F")
    .replace(/\u0A72\u0A48/g, "\u0910")
    .replace(/\u0A73\u0A41/g, "\u0909")
    .replace(/\u0A73\u0A42/g, "\u090A")
    .replace(/\u0A73\u0A4B/g, "\u0913")
    .replace(/\u0A73\u0A4C/g, "\u0914");

  let out = "";
  for (const ch of normalizedGurmukhi) {
    out += transliterateIndicChar(ch);
  }
  return out;
}

/**
 * Selects the most natural Indian-accented voice available on the device for `lang`.
 * Never falls back to a British/US voice if an Indian (`-IN`) voice is available on the device.
 */
export function selectIndianVoice(
  lang: SpeechLang,
  voicesOverride?: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined {
  ensureVoicesPrewarmed();
  const voices = voicesOverride ?? (canSpeak() ? speechSynthesis.getVoices() : []);
  if (!voices || voices.length === 0) return undefined;

  const targetTag = BCP47[lang].toLowerCase();
  const langPrefix = targetTag.split("-")[0] ?? lang;
  const keywords = PREFERRED_INDIAN_VOICE_KEYWORDS[lang] ?? PREFERRED_INDIAN_VOICE_KEYWORDS.en;

  const normLang = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");

  // 1. Exact target locale (e.g. hi-IN, en-IN, pa-IN, mr-IN, gu-IN, ta-IN) + preferred natural Indian voice name
  for (const kw of keywords) {
    const match = voices.find(
      (v) =>
        (normLang(v) === targetTag || normLang(v).startsWith(`${langPrefix}-in`)) &&
        v.name.toLowerCase().includes(kw),
    );
    if (match) return match;
  }

  // 2. Any Microsoft Natural / Online Indian voice for the target language
  const naturalMatch = voices.find(
    (v) =>
      (normLang(v) === targetTag || normLang(v).startsWith(langPrefix)) &&
      (v.name.toLowerCase().includes("natural") || v.name.toLowerCase().includes("india")),
  );
  if (naturalMatch) return naturalMatch;

  // 3. Exact BCP-47 tag match (e.g. mr-IN, pa-IN, gu-IN, ta-IN, hi-IN, en-IN)
  const exactTagMatch = voices.find((v) => normLang(v) === targetTag);
  if (exactTagMatch) return exactTagMatch;

  // 4. Language prefix match (e.g. hi, pa, mr, gu, ta)
  if (langPrefix !== "en") {
    const prefixMatch = voices.find((v) => normLang(v).startsWith(langPrefix));
    if (prefixMatch) return prefixMatch;
  }

  // 5. Fallback to an Indian voice (hi-IN for all Indic scripts via adaptScriptForVoice, en-IN for English)
  // so the voice always speaks with an authentic Indian accent even when a regional OS pack isn't installed.
  const indianFallbackTag = lang === "en" ? "en-in" : "hi-in";
  return (
    voices.find((v) => normLang(v) === indianFallbackTag) ??
    voices.find((v) => normLang(v).endsWith("-in") || v.name.toLowerCase().includes("india")) ??
    voices.find((v) => normLang(v).startsWith(langPrefix))
  );
}

/** Reads `text` aloud with an Indian voice and warm cadence, replacing anything already speaking. */
export function speak(text: string, lang: SpeechLang, onEnd?: () => void): void {
  if (!canSpeak() || text.trim() === "") {
    onEnd?.();
    return;
  }
  ensureVoicesPrewarmed();
  speechSynthesis.cancel();
  const v = selectIndianVoice(lang);
  const effectiveVoiceLang = v?.lang || BCP47[lang];
  const spokenText = adaptScriptForVoice(text, lang, effectiveVoiceLang);
  const u = new SpeechSynthesisUtterance(spokenText);
  if (v) {
    u.voice = v;
    u.lang = effectiveVoiceLang;
  } else {
    u.lang = BCP47[lang];
  }
  // Warm, clear Indian conversational cadence (slightly measured rate and natural inflection)
  u.rate = 0.96;
  u.pitch = 1.02;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (canSpeak()) speechSynthesis.cancel();
}

// ---- speech recognition ----

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen(): boolean {
  return recognitionCtor() !== null;
}

export type ListenError = "micDenied" | "noSpeech" | "network" | "unsupported" | "failed";

/**
 * Listens once in the language. `onText` gets the running transcript (interim, then final);
 * `onDone` gets the final text ("" when nothing was heard) or an error. Returns a stop function
 * that ends listening and keeps what was heard.
 */
export function listen(
  lang: SpeechLang,
  onText: (text: string) => void,
  onDone: (text: string, error: ListenError | null) => void,
): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    onDone("", "unsupported");
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = BCP47[lang];
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let text = "";
  let error: ListenError | null = null;
  rec.onresult = (e) => {
    let all = "";
    for (let i = 0; i < e.results.length; i++) all += e.results[i]?.[0].transcript ?? "";
    text = all.trim();
    onText(text);
  };
  rec.onerror = (e) => {
    error =
      e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "micDenied"
        : e.error === "no-speech"
          ? "noSpeech"
          : e.error === "network"
            ? "network"
            : e.error === "aborted"
              ? null
              : "failed";
  };
  rec.onend = () => onDone(text, text === "" && error === null ? "noSpeech" : text ? null : error);
  try {
    rec.start();
  } catch {
    onDone("", "failed");
  }
  return () => rec.stop();
}
