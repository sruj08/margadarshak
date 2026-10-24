"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { Mic } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { LiveVoiceSheet } from "@/features/voice/LiveVoiceSheet";
import { Link, useRouter } from "@/i18n/navigation";
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
      <button
        type="button"
        className="mj-voice"
        onClick={() => setOpen(true)}
        data-testid="voice-open"
      >
        <span className="mj-voice__orb" aria-hidden="true">
          <Mic size={24} strokeWidth={1.75} />
        </span>
        <span className="mj-voice__text">
          <span className="mj-voice__title">{t("cta")}</span>
          <span className="mj-voice__line">{t("ctaLine")}</span>
        </span>
      </button>
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
  lang: "hi" | "en";
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
  const [phase, setPhase] = useState<"idle" | "recording" | "thinking">("idle");
  const [voiceError, setVoiceError] = useState<"micDenied" | "micFail" | "noSpeech" | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const startedAt = useRef(0);

  // The on-screen line is the authoritative answer; reading it aloud is a convenience.
  const speak = (line: string, lang: "hi" | "en") => {
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(line);
    u.lang = lang === "hi" ? "hi-IN" : "en-IN";
    speechSynthesis.speak(u);
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

  const ask = (value: string) => {
    const r = redact(value);
    setRedacted(r.changed);
    setText(r.text);
    const intent = routeIntent(r.text);
    const lang = langOf(r.text);
    if (lang === locale) {
      return present(
        { intent, lang, reply: t(`intent.${intent}`), goLabel: t(`go_${intent}`) },
        false,
      );
    }
    // Typed in the other language: the server returns the reply in that language.
    void fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: r.text }),
    })
      .then((res) =>
        res.ok ? (res.json() as Promise<Answer>) : Promise.reject(new Error("voice")),
      )
      .then((a) => present(a, false))
      .catch(() =>
        present(
          {
            intent,
            lang: locale as "hi" | "en",
            reply: t(`intent.${intent}`),
            goLabel: t(`go_${intent}`),
          },
          false,
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
      if (!res.ok) throw new Error("voice");
      const out = (await res.json()) as Partial<Answer> & { transcript: string };
      if (!out.transcript || !out.reply || !(INTENTS as readonly unknown[]).includes(out.intent)) {
        setVoiceError("noSpeech");
        return;
      }
      const r = redact(out.transcript);
      setRedacted(r.changed);
      setText(r.text);
      present(out as Answer, true);
    } catch {
      setVoiceError("micFail");
    } finally {
      setPhase("idle");
    }
  };

  const toggleMic = async () => {
    if (phase === "recording") return recorder.current?.stop();
    if (phase !== "idle") return;
    setVoiceError(null);
    setAnswer(null);
    if (timer.current) clearTimeout(timer.current);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return setVoiceError("micFail");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setVoiceError("micDenied");
    }
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      for (const tr of stream.getTracks()) tr.stop();
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      // Under a second of audio is silence or a mis-tap: do not send it for transcription.
      if (Date.now() - startedAt.current < 900 || blob.size < 2000) {
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
        if (!o && timer.current) clearTimeout(timer.current);
        onOpenChange(o);
      }}
      title={t("title")}
      description={t("comingSoon")}
      closeLabel={ta("close")}
    >
      <div className="mj-screen" style={{ gap: 14 }} data-screen="SCR-005">
        <p>{t("whatItWillDo")}</p>
        <p className="mj-muted">{t("boundary")}</p>
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
        <p className="mj-caption" role="status" aria-live="polite">
          {phase === "recording"
            ? t("listening")
            : phase === "thinking"
              ? t("thinking")
              : voiceError
                ? t(voiceError)
                : ""}
        </p>
        <form
          className="mj-screen"
          style={{ gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <div className="mj-input-group">
            <label htmlFor="tell-us" className="md-field__label">
              {t("tellUs")}
            </label>
            <input
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
          <fieldset className="mj-chips" style={{ border: 0, padding: 0, margin: 0 }}>
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
            <p lang={answer.lang}>{answer.reply}</p>
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
