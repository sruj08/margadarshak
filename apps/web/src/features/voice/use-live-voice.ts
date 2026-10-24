"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createVoiceTicket, type VoiceServerMessage, voiceSocketUrl } from "@/features/ai/api";
import { type Mic, Player, startMic } from "./audio";

export type VoicePhase = "connecting" | "live" | "text" | "failed";

export interface Caption {
  readonly id: number;
  readonly who: "you" | "guide";
  readonly text: string;
}

export interface PendingConfirm {
  readonly actionId: string;
  readonly kind: "navigate" | "field";
  readonly label: string;
  readonly screenId?: string;
}

/** Where a confirmed or immediate navigation lands (the server's screen catalogue, VOICE.md §4.1). */
export const SCREEN_HREF: Record<string, string> = {
  SCR_HOME: "/",
  SCR_PLAN: "/plan",
  SCR_PLAN_RESULT: "/plan/card",
  SCR_LL_APPLY: "/apply",
  SCR_HANDOFF_SARATHI: "/apply/handoff",
  SCR_TRACKER: "/licence",
  SCR_LL_SIMULATOR: "/learn/practise/ll-sim",
  SCR_NAZAR: "/learn/practise/nazar",
};

/**
 * One live voice session (API-40). The ticket call runs the AI gate; any refusal (no consent,
 * flag off, monthly cap, offline, mock mode) returns "unavailable" so the caller falls back to the
 * text sheet (MD-316). With a ticket but no live audio (breaker open, Dogri) the session runs in
 * text mode over the same socket and the same agent.
 */
export function useLiveVoice(lang: "hi" | "en" | "doi", onNavigate: (href: string) => void) {
  const [phase, setPhase] = useState<VoicePhase>("connecting");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [confirm, setConfirm] = useState<PendingConfirm[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [dogriDraft, setDogriDraft] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const mic = useRef<Mic | null>(null);
  const player = useRef<Player | null>(null);
  const seq = useRef(0);

  const caption = useCallback((who: Caption["who"], text: string) => {
    setCaptions((c) => [...c.slice(-19), { id: ++seq.current, who, text }]);
  }, []);

  // ui_action: a read-back card to confirm, a navigation (closes the card) or a saved field.
  const onAction = useCallback(
    (a: VoiceServerMessage["action"]) => {
      if (a?.kind === "read_back" && a.action_id) {
        const id = a.action_id;
        const card: PendingConfirm = { actionId: id, kind: "field", label: a.value ?? "" };
        setConfirm((c) => [...c.filter((x) => x.actionId !== id), card]);
      } else if (a?.kind === "navigate" && a.screen_id) {
        const screen = a.screen_id;
        setConfirm((c) => c.filter((x) => x.screenId !== screen));
        const href = SCREEN_HREF[screen];
        if (href) onNavigate(href);
      } else if (a?.kind === "set_field" && a.action_id) {
        const id = a.action_id;
        setConfirm((c) => c.filter((x) => x.actionId !== id));
      }
    },
    [onNavigate],
  );

  const onMessage = useCallback(
    (m: VoiceServerMessage) => {
      switch (m.type) {
        case "transcript_in":
          if (lang === "doi" && m.text) setDogriDraft(m.text);
          else if (m.text) caption("you", m.text);
          break;
        case "transcript_out":
          if (m.text) caption("guide", m.text);
          break;
        case "pii_blocked":
          setBlocked(true);
          break;
        case "interrupted":
          player.current?.stop();
          setConfirm([]);
          break;
        case "confirm_request":
          if (m.action?.action_id && m.action.screen_id) {
            const id = m.action.action_id;
            const screenId = m.action.screen_id;
            setConfirm((c) => [
              ...c.filter((x) => x.actionId !== id),
              { actionId: id, kind: "navigate", label: screenId, screenId },
            ]);
          }
          break;
        case "ui_action":
          onAction(m.action);
          break;
        case "error":
        case "session_end":
          setPhase((p) => (p === "live" ? "text" : p));
          break;
      }
    },
    [caption, lang, onAction],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const ticket = await createVoiceTicket();
      const url = voiceSocketUrl(lang);
      if (!alive) return;
      if (!ticket.ok || !url) {
        setUnavailable(true);
        return;
      }
      const sock = new WebSocket(url);
      sock.binaryType = "arraybuffer";
      ws.current = sock;
      player.current = new Player();
      sock.onopen = () => {
        sock.send(
          JSON.stringify({
            type: "hello",
            v: 1,
            locale: lang,
            screen: "SCR_HOME",
            token: ticket.data.ticket,
          }),
        );
        if (!ticket.data.live || lang === "doi") {
          setPhase("text");
          return;
        }
        startMic((pcm) => sock.readyState === WebSocket.OPEN && sock.send(pcm))
          .then((m) => {
            if (!alive) return m.stop();
            mic.current = m;
            setPhase("live");
          })
          .catch(() => setPhase("text")); // mic denied: same agent, typed
      };
      sock.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
        if (typeof e.data === "string") {
          try {
            onMessage(JSON.parse(e.data) as VoiceServerMessage);
          } catch {
            // not a JSON frame
          }
        } else {
          void player.current?.play(e.data);
        }
      };
      sock.onerror = () => setPhase("failed");
      sock.onclose = () => {
        mic.current?.stop();
        mic.current = null;
        setPhase((p) => (p === "connecting" ? "failed" : p === "live" ? "text" : p));
      };
    })();
    return () => {
      alive = false;
      mic.current?.stop();
      player.current?.close();
      ws.current?.close();
    };
  }, [lang, onMessage]);

  const sendJson = (v: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(v));
  };

  return {
    phase,
    captions,
    confirm,
    blocked,
    unavailable,
    dogriDraft,
    sendText: (text: string) => {
      const t = text.trim().slice(0, 500);
      if (!t) return;
      setBlocked(false);
      setDogriDraft(null);
      sendJson({ type: "text", text: t });
    },
    accept: (actionId: string) => sendJson({ type: "confirm", confirm_action_id: actionId }),
    reject: (actionId: string) => {
      setConfirm((c) => c.filter((x) => x.actionId !== actionId));
      sendJson({ type: "cancel" });
    },
    /** Dogri push-to-talk: audio frames while held, then `stop` asks Saaras for the transcript. */
    holdStart: async () => {
      if (mic.current) return;
      try {
        mic.current = await startMic(
          (pcm) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(pcm),
        );
      } catch {
        setPhase("text");
      }
    },
    holdEnd: () => {
      mic.current?.stop();
      mic.current = null;
      sendJson({ type: "stop" });
    },
  };
}
