"use client";

import { useCallback, useEffect, useState } from "react";
import { CuratorApiError, CuratorOffline, getClip, type Source } from "./api";
import type { Clip } from "./types";

export type ClipLoad =
  | { k: "loading" }
  | { k: "offline" }
  | { k: "notfound" }
  | { k: "forbidden" }
  | { k: "error" }
  | { k: "ready"; clip: Clip; source: Source };

/** Loads one clip (GET /v1/admin/clips/{id}) with the screen states; `set` keeps a fresh copy. */
export function useClip(id: string) {
  const [state, setState] = useState<ClipLoad>({ k: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    void attempt;
    let alive = true;
    getClip(id)
      .then((r) => alive && setState({ k: "ready", clip: r.data, source: r.source }))
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof CuratorOffline) setState({ k: "offline" });
        else if (e instanceof CuratorApiError && e.status === 404) setState({ k: "notfound" });
        else if (e instanceof CuratorApiError && (e.status === 401 || e.status === 403))
          setState({ k: "forbidden" });
        else setState({ k: "error" });
      });
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  const set = useCallback(
    (clip: Clip, source: Source) => setState({ k: "ready", clip, source }),
    [],
  );
  return { state, reload, set };
}

/** A new Idempotency-Key per user action (kept while the action retries). */
export const newKey = (): string => crypto.randomUUID();
