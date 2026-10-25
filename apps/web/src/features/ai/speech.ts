"use client";

/**
 * Browser speech for the coach: speech synthesis reads a turn aloud and speech recognition turns
 * the learner's spoken reply into text, both in the UI language (hi-IN, en-IN). Recognition is the
 * browser's own service (Chrome sends the audio to its speech service; we never receive audio).
 * Neither is required: the text is always on screen and a reply can always be typed.
 */

export type SpeechLang = "en" | "hi";
const BCP47: Record<SpeechLang, string> = { en: "en-IN", hi: "hi-IN" };

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** A voice for the language when the device has one (Hindi voices are missing on some phones). */
function voiceFor(lang: SpeechLang): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  const tag = BCP47[lang].toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase().replace("_", "-") === tag) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(lang))
  );
}

/** Reads `text` aloud, replacing anything already speaking. Calls onEnd when done or stopped. */
export function speak(text: string, lang: SpeechLang, onEnd?: () => void): void {
  if (!canSpeak() || text.trim() === "") {
    onEnd?.();
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = BCP47[lang];
  const v = voiceFor(lang);
  if (v) u.voice = v;
  u.rate = 1;
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
