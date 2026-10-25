"use client";

import "./coach.css";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import {
  type AiFailure,
  aiFailure,
  type CoachTurn,
  type CoachTurnRequest,
  coachTurn,
  sendAIFeedback,
} from "./api";
import {
  canListen,
  canSpeak,
  type ListenError,
  listen,
  type SpeechLang,
  speak,
  stopSpeaking,
} from "./speech";

/** What the learner just answered: an LL bank variant, one Nazar clip's scored outcome, or one
 * Stopping Distance round / Blind Spot placement. */
export type CoachSubject =
  | { game: "ll"; itemId: string; chosenOptionId: string }
  | { game: "nazar"; key: string; clip: NonNullable<CoachTurnRequest["clip"]> }
  | { game: "sim"; key: string; sim: NonNullable<CoachTurnRequest["sim"]> };

const VOICE_KEY = "md.coach.voice";

function voiceOn(): boolean {
  try {
    return localStorage.getItem(VOICE_KEY) !== "off";
  } catch {
    return true;
  }
}

function request(s: CoachSubject): CoachTurnRequest {
  if (s.game === "nazar") return { kind: "feedback", game: "nazar", clip: s.clip };
  if (s.game === "sim") return { kind: "feedback", game: "sim", sim: s.sim };
  const [question_id = "", variant_id = ""] = s.itemId.split(":");
  return {
    kind: "feedback",
    game: "ll",
    question: { question_id, variant_id, chosen_option_id: s.chosenOptionId },
  };
}

/** One feedback request per answered question, shared by remounts (and React's dev double run). */
const inflight = new Map<string, ReturnType<typeof coachTurn>>();
function feedbackFor(key: string, s: CoachSubject, fresh = false): ReturnType<typeof coachTurn> {
  const known = inflight.get(key);
  if (known && !fresh) return known;
  const p = coachTurn(request(s));
  inflight.set(key, p);
  // A failed turn may be retried; keep only the last few answers.
  void p.then((r) => (!r.ok ? inflight.delete(key) : undefined));
  if (inflight.size > 20) inflight.delete(inflight.keys().next().value as string);
  return p;
}

const subjectKey = (s: CoachSubject) =>
  s.game === "ll" ? `ll:${s.itemId}:${s.chosenOptionId}` : `${s.game}:${s.key}`;

type Feedback = { k: "loading" } | { k: "ai"; turn: CoachTurn } | { k: "fallback"; why: AiFailure };

type Reply =
  | { k: "idle" }
  | { k: "listening"; text: string }
  | { k: "thinking" }
  | { k: "done"; turn: CoachTurn }
  | { k: "failed" };

/**
 * The question-wise coach (API-79) inside the practice flow: right after an answer it fetches a
 * short spoken explanation of THIS question or clip and reads it aloud; after a mistake it asks one
 * follow-up the learner can answer by voice or by typing. Nothing here blocks the game: the
 * parent's Continue button stays live, and leaving the question stops speech, listening and any
 * late answer (stale turns are dropped). Without AI (preview, offline, no consent, model busy) it
 * says why and can read the reviewed explanation aloud, labelled as such.
 */
export function QuestionCoach({
  subject,
  fallbackText,
}: {
  subject: CoachSubject;
  /** The reviewed explanation already on screen; read aloud when the AI coach is unavailable. */
  fallbackText: string | null;
}) {
  const t = useTranslations("ai.coachTurn");
  const lang: SpeechLang = useLocale() === "hi" ? "hi" : "en";
  const key = subjectKey(subject);
  const [fb, setFb] = useState<Feedback>({ k: "loading" });
  const [reply, setReply] = useState<Reply>({ k: "idle" });
  const [typed, setTyped] = useState("");
  const [voice, setVoice] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [listenErr, setListenErr] = useState<ListenError | null>(null);
  const [rated, setRated] = useState(false);
  const live = useRef(key);
  const stopListening = useRef<(() => void) | null>(null);
  const subjectRef = useRef(subject);
  subjectRef.current = subject;

  const hush = () => {
    stopSpeaking();
    setSpeaking(false);
  };

  const say = (text: string) => {
    if (!canSpeak()) return;
    setSpeaking(true);
    speak(text, lang, () => setSpeaking(false));
  };

  // One feedback request per answered question; a late answer for an old question is dropped.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the subject only
  useEffect(() => {
    live.current = key;
    setFb({ k: "loading" });
    setReply({ k: "idle" });
    setTyped("");
    setListenErr(null);
    setRated(false);
    const on = voiceOn();
    setVoice(on);
    void feedbackFor(key, subjectRef.current).then((r) => {
      if (live.current !== key) return;
      if (r.ok) {
        setFb({ k: "ai", turn: r.data });
        if (on) say(r.data.follow_up ? `${r.data.say} ${r.data.follow_up}` : r.data.say);
      } else setFb({ k: "fallback", why: aiFailure(r) });
    });
    return () => {
      live.current = "";
      stopListening.current?.();
      stopSpeaking();
    };
  }, [key]);

  const toggleVoice = () => {
    const next = !voice;
    setVoice(next);
    try {
      localStorage.setItem(VOICE_KEY, next ? "on" : "off");
    } catch {
      // private mode: the toggle still works for this page
    }
    if (!next) hush();
  };

  const sendReply = (answer: string) => {
    if (fb.k !== "ai" || !fb.turn.follow_up || answer.trim() === "") return;
    stopSpeaking();
    setReply({ k: "thinking" });
    void coachTurn({
      ...request(subject),
      kind: "reply",
      follow_up: fb.turn.follow_up,
      answer: answer.slice(0, 500),
    }).then((r) => {
      if (live.current !== key) return;
      if (!r.ok) return setReply({ k: "failed" });
      setReply({ k: "done", turn: r.data });
      if (voice) say(r.data.say);
    });
  };

  const startListening = () => {
    stopSpeaking();
    setListenErr(null);
    setReply({ k: "listening", text: "" });
    stopListening.current = listen(
      lang,
      (text) => live.current === key && setReply({ k: "listening", text }),
      (text, err) => {
        stopListening.current = null;
        if (live.current !== key) return;
        if (err || !text) {
          setListenErr(err ?? "noSpeech");
          setReply({ k: "idle" });
          return;
        }
        setTyped(text);
        sendReply(text);
      },
    );
  };

  const retry = () => {
    setFb({ k: "loading" });
    void feedbackFor(key, subject, true).then((r) => {
      if (live.current !== key) return;
      if (r.ok) {
        setFb({ k: "ai", turn: r.data });
        if (voice) say(r.data.say);
      } else setFb({ k: "fallback", why: aiFailure(r) });
    });
  };

  const voiceButton = canSpeak() ? (
    <button
      type="button"
      className="md-coach__btn"
      onClick={toggleVoice}
      aria-pressed={voice}
      data-testid="coach-voice-toggle"
    >
      {voice ? t("voiceOff") : t("voiceOn")}
    </button>
  ) : null;

  if (fb.k === "loading")
    return (
      <section className="md-coach" aria-busy="true" data-testid="coach-turn" data-state="loading">
        <p className="md-coach__chip">{t("ai")}</p>
        <p role="status" className="md-coach__small">
          {t("thinking")}
        </p>
      </section>
    );

  if (fb.k === "fallback")
    return (
      <section
        className="md-coach"
        data-testid="coach-turn"
        data-state="fallback"
        data-why={fb.why}
      >
        <p className="md-coach__chip">{t("reviewed")}</p>
        <p className="md-coach__small">
          {t(`status.${fb.why}`)}{" "}
          {fb.why === "signin" ? (
            <Link href="/signin" className="md-coach__btn">
              {t("signin")}
            </Link>
          ) : fb.why === "consent" ? (
            <Link href="/privacy" className="md-coach__btn">
              {t("turnOn")}
            </Link>
          ) : fb.why === "busy" || fb.why === "offline" ? (
            <button type="button" className="md-coach__btn" onClick={retry}>
              {t("retry")}
            </button>
          ) : null}
        </p>
        {fallbackText && canSpeak() ? (
          <button
            type="button"
            className="md-coach__btn"
            onClick={() => (speaking ? hush() : say(fallbackText))}
            data-testid="coach-listen"
          >
            {speaking ? t("stop") : t("listen")}
          </button>
        ) : null}
      </section>
    );

  const turn = fb.turn;
  return (
    <section
      className="md-coach"
      aria-labelledby={`coach-${key}`}
      data-testid="coach-turn"
      data-state="ai"
    >
      <div className="md-coach__row">
        <p id={`coach-${key}`} className="md-coach__chip">
          {t("ai")}
        </p>
        {voiceButton}
        {canSpeak() ? (
          <button
            type="button"
            className="md-coach__btn"
            onClick={() => (speaking ? hush() : say(turn.say))}
          >
            {speaking ? t("stop") : t("replay")}
          </button>
        ) : null}
      </div>
      <p lang={lang} data-testid="coach-say">
        {turn.say}
      </p>
      {turn.follow_up ? (
        <div className="md-coach__stack" data-testid="coach-followup">
          <p className="md-coach__strong" lang={lang}>
            {t("followTitle")} {turn.follow_up}
          </p>
          {reply.k === "done" ? (
            <div role="status" data-testid="coach-reply" data-verdict={reply.turn.verdict ?? ""}>
              <p className="md-coach__strong">{t(`verdict.${reply.turn.verdict ?? "partly"}`)}</p>
              <p lang={lang}>{reply.turn.say}</p>
            </div>
          ) : (
            <form
              className="md-coach__stack"
              onSubmit={(e) => {
                e.preventDefault();
                sendReply(typed);
              }}
            >
              {canListen() ? (
                <button
                  type="button"
                  className="md-coach__btn"
                  onClick={() =>
                    reply.k === "listening" ? stopListening.current?.() : startListening()
                  }
                  disabled={reply.k === "thinking"}
                  aria-pressed={reply.k === "listening"}
                  data-testid="coach-mic"
                >
                  {reply.k === "listening" ? t("doneSpeaking") : t("answerVoice")}
                </button>
              ) : null}
              {canListen() ? <p className="md-coach__small">{t("micNote")}</p> : null}
              {reply.k === "listening" ? (
                <p role="status" className="md-coach__small" lang={lang}>
                  {reply.text || t("listening")}
                </p>
              ) : null}
              {listenErr ? (
                <p role="status" className="md-coach__small">
                  {t(`mic.${listenErr}`)}
                </p>
              ) : null}
              <label className="md-field__label" htmlFor={`coach-answer-${key}`}>
                {canListen() ? t("orType") : t("typeAnswer")}
              </label>
              <div className="md-coach__row">
                <input
                  id={`coach-answer-${key}`}
                  className="md-coach__input"
                  value={typed}
                  maxLength={500}
                  onChange={(e) => setTyped(e.target.value)}
                  disabled={reply.k === "thinking" || reply.k === "listening"}
                  lang={lang}
                />
                <button
                  type="submit"
                  className="md-coach__btn"
                  disabled={reply.k === "thinking" || typed.trim() === ""}
                >
                  {t("send")}
                </button>
              </div>
              {reply.k === "thinking" ? (
                <p role="status" className="md-coach__small">
                  {t("thinking")}
                </p>
              ) : null}
              {reply.k === "failed" ? (
                <p role="status" className="md-coach__small">
                  {t("replyFailed")}
                </p>
              ) : null}
              <p className="md-coach__small">{t("skipHint")}</p>
            </form>
          )}
        </div>
      ) : null}
      {rated ? (
        <p className="md-coach__small" role="status">
          {t("thanks")}
        </p>
      ) : (
        <div className="md-coach__row md-coach__small">
          <span>{t("helpful")}</span>
          {([true, false] as const).map((h) => (
            <button
              key={String(h)}
              type="button"
              className="md-coach__btn"
              onClick={() => {
                setRated(true);
                void sendAIFeedback("coach", key, h);
              }}
            >
              {h ? t("yes") : t("no")}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
