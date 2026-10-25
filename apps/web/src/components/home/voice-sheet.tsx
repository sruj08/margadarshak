"use client";

import { Button as HeroButton, Input, Label } from "@heroui/react";
import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { Mic, Volume2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  canListen,
  listen,
  speak as speakIndian,
  stopSpeaking,
  toSpeechLang,
} from "@/features/ai/speech";
import { LiveVoiceSheet } from "@/features/voice/LiveVoiceSheet";
import { Link, useRouter } from "@/i18n/navigation";
import { APP_LOCALES, type AppLocale, LANGUAGE_META } from "@/i18n/routing";
import { INTENT_HREF, INTENTS, type Intent, langOf, routeIntent } from "@/lib/journey/intents";
import { redact } from "@/lib/redact/redact";

/**
 * "Or just tell us" (SCR-003). The mic opens the live voice guide (MD-314, API-40). When the
 * guide is unavailable (no ai_voice consent, the state's flag off, the monthly cap, offline, mock
 * mode, or the socket fails) the plain sheet below takes over (MD-316): a "tell us" box routed to
 * the same intents, with a short recorded clip. Text is redacted on the device first (EC-20).
 * Available to every user, including family mode (D-13 revised).
 */
export function VoiceButton() {
  const t = useTranslations("voice");
  const [open, setOpen] = useState(false);
  const [fallback, setFallback] = useState(false);
  const onUnavailable = useCallback(() => setFallback(true), []);
  return (
    <>
      <HeroButton className="mj-voice" onPress={() => setOpen(true)} data-testid="voice-open">
        <span className="mj-voice__orb" aria-hidden="true">
          <Mic size={24} strokeWidth={1.75} />
        </span>
        <span className="mj-voice__text">
          <span className="mj-voice__title">{t("cta")}</span>
          <span className="mj-voice__line">{t("ctaLine")}</span>
        </span>
      </HeroButton>
      {open && !fallback ? (
        <LiveVoiceSheet isOpen={open} onOpenChange={setOpen} onUnavailable={onUnavailable} />
      ) : (
        <VoiceSheet isOpen={open} onOpenChange={setOpen} />
      )}
    </>
  );
}

interface Answer {
  intent: Intent;
  lang: AppLocale;
  reply: string;
  goLabel: string;
}

export function VoiceSheet({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("voice");
  const ta = useTranslations("a11y");
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [redacted, setRedacted] = useState(false);
  const chips = [t("chip1"), t("chip2"), t("chip3")];
  const locale = useLocale();
  const [voiceLang, setVoiceLang] = useState<AppLocale>(() => toSpeechLang(locale));
  useEffect(() => {
    setVoiceLang(toSpeechLang(locale));
  }, [locale]);
  const [phase, setPhase] = useState<"idle" | "recording" | "thinking">("idle");
  const [voiceError, setVoiceError] = useState<"micDenied" | "micFail" | "noSpeech" | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stopBrowserStt = useRef<(() => void) | null>(null);
  const browserTranscript = useRef<string>("");
  const startedAt = useRef(0);

  // The on-screen line is the authoritative answer; reading it aloud uses the Indianized voice engine.
  const speak = (line: string, lang: AppLocale) => {
    speakIndian(line, toSpeechLang(lang));
  };

  // Show and read the answer, then open the screen after a short pause so it can be read first.
  const present = (a: Answer, spoken: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    setAnswer(a);
    if (spoken) speak(a.reply, a.lang);
    const href = INTENT_HREF[a.intent];
    if (!href) return;
    timer.current = setTimeout(() => {
      onOpenChange(false);
      router.push(href);
    }, 3000);
  };

  const ask = (value: string, spoken = false) => {
    const r = redact(value);
    setRedacted(r.changed);
    setText(r.text);
    const intent = routeIntent(r.text);
    const detected = langOf(r.text);
    const targetLang: AppLocale =
      voiceLang !== toSpeechLang(locale) && detected === "en" ? voiceLang : detected;
    if (targetLang === locale) {
      return present(
        { intent, lang: targetLang, reply: t(`intent.${intent}`), goLabel: t(`go_${intent}`) },
        spoken,
      );
    }
    // Typed or spoken in another language: the server returns the reply in that language.
    void fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: r.text, lang: targetLang }),
    })
      .then((res) =>
        res.ok ? (res.json() as Promise<Answer>) : Promise.reject(new Error("voice")),
      )
      .then((a) => present(a, spoken))
      .catch(() =>
        present(
          {
            intent,
            lang: toSpeechLang(locale),
            reply: t(`intent.${intent}`),
            goLabel: t(`go_${intent}`),
          },
          spoken,
        ),
      );
  };

  const send = async (blob: Blob) => {
    setPhase("thinking");
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      if (!res.ok) {
        if (browserTranscript.current.trim()) {
          ask(browserTranscript.current, true);
          return;
        }
        throw new Error("voice");
      }
      const out = (await res.json()) as Partial<Answer> & { transcript: string };
      if (!out.transcript || !out.reply || !(INTENTS as readonly unknown[]).includes(out.intent)) {
        if (browserTranscript.current.trim()) {
          ask(browserTranscript.current, true);
          return;
        }
        setVoiceError("noSpeech");
        return;
      }
      const r = redact(out.transcript);
      setRedacted(r.changed);
      setText(r.text);
      present(out as Answer, true);
    } catch {
      if (browserTranscript.current.trim()) {
        ask(browserTranscript.current, true);
      } else {
        setVoiceError("micFail");
      }
    } finally {
      setPhase("idle");
    }
  };

  const toggleMic = async () => {
    if (phase === "recording") {
      stopBrowserStt.current?.();
      stopBrowserStt.current = null;
      return recorder.current?.stop();
    }
    if (phase !== "idle") return;
    setVoiceError(null);
    setAnswer(null);
    browserTranscript.current = "";
    if (timer.current) clearTimeout(timer.current);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      if (canListen()) {
        setPhase("recording");
        stopBrowserStt.current = listen(
          toSpeechLang(voiceLang),
          (tText) => {
            browserTranscript.current = tText;
            ask(tText, true);
          },
          () => setPhase("idle"),
        );
        return;
      }
      return setVoiceError("micFail");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setVoiceError("micDenied");
    }
    if (canListen()) {
      stopBrowserStt.current = listen(
        toSpeechLang(voiceLang),
        (tText) => {
          browserTranscript.current = tText;
        },
        () => {
          stopBrowserStt.current = null;
        },
      );
    }
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      stopBrowserStt.current?.();
      stopBrowserStt.current = null;
      for (const tr of stream.getTracks()) tr.stop();
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      if (Date.now() - startedAt.current < 900 || blob.size < 2000) {
        if (browserTranscript.current.trim()) {
          setPhase("idle");
          ask(browserTranscript.current, true);
          return;
        }
        setPhase("idle");
        return setVoiceError("noSpeech");
      }
      void send(blob);
    };
    recorder.current = rec;
    startedAt.current = Date.now();
    rec.start();
    setPhase("recording");
    // shortcut: 20 s cap keeps clips small, upgrade to streaming with the live voice socket (MD-313).
    setTimeout(() => rec.state === "recording" && rec.stop(), 20_000);
  };

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={(o) => {
        if (!o) {
          if (timer.current) clearTimeout(timer.current);
          stopSpeaking();
        }
        onOpenChange(o);
      }}
      title={t("title")}
      description={t("comingSoon")}
      closeLabel={ta("close")}
    >
      <div className="mj-screen mj-voice-live" data-screen="SCR-005">
        <p>{t("whatItWillDo")}</p>
        <p className="mj-muted">{t("boundary")}</p>
        <fieldset
          className="md-voice-langs"
          style={{ border: 0, margin: 0, padding: 0 }}
          aria-label={t("title")}
        >
          {APP_LOCALES.map((code) => {
            const meta = LANGUAGE_META[code];
            const active = voiceLang === code;
            return (
              <button
                key={code}
                type="button"
                lang={code}
                className={`md-voice-langs__pill${active ? " md-voice-langs__pill--active" : ""}`}
                aria-pressed={active}
                onClick={() => {
                  setVoiceLang(code);
                  speakIndian(meta.sampleGreeting, code);
                }}
                data-testid={`voice-sheet-lang-${code}`}
              >
                {meta.nativeLabel}
              </button>
            );
          })}
        </fieldset>
        <Button
          variant={phase === "recording" ? "danger" : "primary"}
          size="lg"
          isPending={phase === "thinking"}
          onPress={() => void toggleMic()}
          data-testid="voice-mic"
        >
          <Mic aria-hidden="true" />
          {phase === "recording" ? t("stop") : t("speak")}
        </Button>
        <p className="mj-caption mj-voice-status" role="status" aria-live="polite">
          {phase === "recording"
            ? t("listening")
            : phase === "thinking"
              ? t("thinking")
              : voiceError
                ? t(voiceError)
                : ""}
        </p>
        <form
          className="mj-voice-form"
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <div className="mj-input-group">
            <Label htmlFor="tell-us" className="md-field__label">
              {t("tellUs")}
            </Label>
            <Input
              id="tell-us"
              className="mj-input"
              value={text}
              autoComplete="off"
              onChange={(e) => {
                setText(e.target.value);
                setAnswer(null);
                if (timer.current) clearTimeout(timer.current);
              }}
              data-testid="tell-us"
            />
          </div>
          <fieldset className="mj-chips mj-voice-chips">
            <legend className="md-sr-only">{t("examples")}</legend>
            {chips.map((c) => (
              <Button
                key={c}
                variant="secondary"
                onPress={() => ask(c)}
                aria-label={t("askChip", { q: c })}
              >
                {c}
              </Button>
            ))}
          </fieldset>
          <Button variant="primary" size="lg" type="submit" isDisabled={text.trim() === ""}>
            {t("go")}
          </Button>
        </form>
        {redacted ? (
          <Banner tone="info" title={t("redactedTitle")} role="status">
            {t("redacted")}
          </Banner>
        ) : null}
        {answer ? (
          <div className="mj-card mj-card--soft" role="status" data-testid="intent-result">
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <p lang={answer.lang} style={{ margin: 0 }}>
                {answer.reply}
              </p>
              <Button
                variant="ghost"
                isIconOnly
                aria-label={t("speak")}
                onPress={() => speak(answer.reply, answer.lang)}
                data-testid="voice-speak-reply"
              >
                <Volume2 size={18} aria-hidden="true" />
              </Button>
            </div>
            {INTENT_HREF[answer.intent] ? (
              <Link
                href={INTENT_HREF[answer.intent] as string}
                className={buttonClassName({ variant: "secondary", fullWidth: true })}
                onClick={() => onOpenChange(false)}
              >
                {answer.goLabel}
              </Link>
            ) : null}
          </div>
        ) : null}
        <section aria-labelledby="voice-ask">
          <p id="voice-ask" className="mj-caption">
            {t("ask")}
          </p>
          <ul className="mj-muted">
            {(["ex1", "ex2", "ex3", "ex4", "ex5", "ex6"] as const).map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </section>
        <p className="mj-caption">{t("privacy")}</p>
        <p className="mj-caption">{t("audioNote")}</p>
      </div>
    </Sheet>
  );
}
