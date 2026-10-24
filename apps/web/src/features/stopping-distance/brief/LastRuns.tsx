"use client";

import type { GameId } from "@margdarshak/game-core/schema";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { listSessionRecords, type SessionRecord } from "@/features/games/results-store";

type State =
  | { k: "loading" }
  | { k: "error" }
  | { k: "empty" }
  | { k: "ok"; runs: SessionRecord[] };

/** Runs shown on the brief [D]. */
const SHOW = 3;

/**
 * The last runs of a game kept on this phone (the host's results store), under the brief. It is
 * where the brief's loading, empty and error states live (UI_SPEC_LEARN_GAMES §1.5): the store is
 * read after mount (it is on the device), so the server HTML always shows the loading skeleton.
 * The score is the server's once checked, else the provisional one, labelled.
 */
export function LastRuns({ gameId }: { gameId: GameId }) {
  const t = useTranslations("sims.runs");
  const f = useFormatter();
  const [state, setState] = useState<State>({ k: "loading" });
  const read = useCallback(() => {
    try {
      const runs = listSessionRecords(gameId)
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(0, SHOW);
      setState(runs.length === 0 ? { k: "empty" } : { k: "ok", runs });
    } catch {
      setState({ k: "error" });
    }
  }, [gameId]);
  useEffect(read, [read]);

  return (
    <section
      className="sims-runs"
      aria-labelledby={`runs-${gameId}`}
      data-testid="last-runs"
      data-state={state.k}
    >
      <h2 id={`runs-${gameId}`} className="md-h3">
        {t("title")}
      </h2>
      {state.k === "loading" ? (
        <div className="sims-runs__skeleton" aria-busy="true" data-testid="runs-loading">
          <span className="md-sr-only" role="status">
            {t("loading")}
          </span>
          <span className="sims-runs__bar" />
          <span className="sims-runs__bar" />
        </div>
      ) : null}
      {state.k === "empty" ? (
        <p className="mg-note mg-note--ink" data-testid="runs-empty">
          {t("empty")}
        </p>
      ) : null}
      {state.k === "error" ? (
        <div className="sims-runs__error" role="alert" data-testid="runs-error">
          <p>{t("error")}</p>
          <button type="button" className="md-link" onClick={read}>
            {t("retry")}
          </button>
        </div>
      ) : null}
      {state.k === "ok" ? (
        <ul className="sims-runs__list" data-testid="runs-list">
          {state.runs.map((r) => {
            const c = r.checked;
            const pct = c
              ? c.server_checked
                ? (c.server_score_pct ?? c.score.pct)
                : c.score.pct
              : null;
            const date = f.dateTime(new Date(r.savedAt), { dateStyle: "medium" });
            return (
              <li key={r.sid}>
                {pct === null
                  ? t("rowPending", { date })
                  : t("row", { date, pct: f.number(pct, { maximumFractionDigits: 1 }) })}{" "}
                <span className="mg-chip">
                  {c?.server_checked ? t("checked") : t("provisional")}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
