"use client";

import type { GameMode } from "@margdarshak/game-core/schema";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Link } from "@/i18n/navigation";
import { readStoredA11y, systemReducedMotion, writeStoredA11y } from "../host/a11y-context";

export interface BriefMode {
  id: GameMode;
  label: string;
  /** One line under the label (e.g. "10 clips, feedback at the end"). */
  line?: string;
}

export interface PreGameBriefProps {
  /** e.g. "Nazar · Spot the hazard early". */
  title: string;
  practise: ReactNode;
  scored: ReactNode;
  controls: ReactNode;
  modes: readonly BriefMode[];
  defaultMode: GameMode;
  /** Locale-less href of the play route for a mode, e.g. `/learn/practise/nazar/play?mode=mock`. */
  playHref: (mode: GameMode) => string;
  /** Screen-reader alternative route; offered as a link, never a block. */
  srHref?: string;
  /** Game-specific notes under the options (format line, photosensitivity, pack download). */
  children?: ReactNode;
}

type Opts = { leftHanded: boolean; reducedMotion: boolean; soundOn: boolean };

/**
 * Pre-game brief (UI_SPEC_LEARN_GAMES §4.1): what you'll practise, how it's scored, controls,
 * options and the mode, in about 10 seconds; one primary action, Start. Options are real checkboxes
 * (nothing pre-ticked except what follows the phone) and persist on this device.
 */
export function PreGameBrief(props: PreGameBriefProps) {
  const t = useTranslations("games");
  const id = useId();
  const [mode, setMode] = useState<GameMode>(props.defaultMode);
  const [opts, setOpts] = useState<Opts>({
    leftHanded: false,
    reducedMotion: false,
    soundOn: false,
  });
  useEffect(() => {
    const s = readStoredA11y();
    setOpts({
      leftHanded: s.leftHanded === true,
      reducedMotion: s.reducedMotion === true || systemReducedMotion(),
      soundOn: s.soundOn === true,
    });
  }, []);
  useEffect(() => setMode(props.defaultMode), [props.defaultMode]);
  const toggle = (k: keyof Opts) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.currentTarget.checked;
    setOpts((o) => ({ ...o, [k]: v }));
    writeStoredA11y({ [k]: v });
  };

  return (
    <section className="mg-brief" aria-labelledby={`${id}-t`} data-testid="game-brief">
      <div className="mg-brief__hero">
        <h1 id={`${id}-t`} className="md-h1">
          {props.title}
        </h1>
      </div>
      <h2 className="md-h3">{t("brief.practise")}</h2>
      <p>{props.practise}</p>
      <h2 className="md-h3">{t("brief.scored")}</h2>
      <p>{props.scored}</p>
      <h2 className="md-h3">{t("brief.controls")}</h2>
      <p>{props.controls}</p>

      <fieldset className="mg-fieldset">
        <legend className="md-h3">{t("brief.mode")}</legend>
        {props.modes.map((m) => (
          <label key={m.id} className="mg-choice">
            <input
              type="radio"
              name={`${id}-mode`}
              value={m.id}
              checked={mode === m.id}
              onChange={() => setMode(m.id)}
              data-testid={`mode-${m.id}`}
            />
            <span>
              <span className="mg-choice__label">{m.label}</span>
              {m.line ? <span className="mg-choice__line">{m.line}</span> : null}
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="mg-fieldset">
        <legend className="md-h3">{t("brief.options")}</legend>
        <label className="mg-choice">
          <input type="checkbox" checked={opts.leftHanded} onChange={toggle("leftHanded")} />
          <span className="mg-choice__label">{t("brief.lefthand")}</span>
        </label>
        <label className="mg-choice">
          <input type="checkbox" checked={opts.reducedMotion} onChange={toggle("reducedMotion")} />
          <span className="mg-choice__label">{t("brief.rm")}</span>
        </label>
        <label className="mg-choice">
          <input type="checkbox" checked={opts.soundOn} onChange={toggle("soundOn")} />
          <span className="mg-choice__label">{t("brief.sound")}</span>
        </label>
        {props.srHref ? (
          <Link href={props.srHref} className="md-link mg-srlink" data-testid="brief-sr-link">
            {t("brief.sr")}
          </Link>
        ) : null}
      </fieldset>

      {props.children}

      <Link
        href={props.playHref(mode)}
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        data-testid="brief-start"
      >
        {t("brief.start")}
      </Link>
      <p className="mg-label mg-label--ink">{t("label")}</p>
    </section>
  );
}
