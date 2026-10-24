"use client";

import { Disclosure } from "@heroui/react";
import type { FormEvent, ReactNode } from "react";
import { cx } from "../lib/cx";
import { StatusGlyph } from "./status-glyph";

/**
 * QuestionScreen (C-12, GOV.UK question-page pattern). One question per screen:
 * back link · progress · h1 = the question · hint · "Why we ask" disclosure · field(s) · one primary
 * action · autosave note. An error summary (if any) goes first and receives focus on submit.
 */
export interface QuestionScreenProps {
  question: ReactNode;
  hint?: ReactNode;
  /** Back link element (a next-intl Link styled as a back link). */
  back?: ReactNode;
  /** Progress element, e.g. <ProgressBar label="Question 2 of 6" .../>. */
  progress?: ReactNode;
  /** Error summary element rendered above the question when present. */
  errorSummary?: ReactNode;
  whyWeAsk?: { label: string; body: ReactNode };
  children: ReactNode;
  /** The single primary action (usually a submit Button). */
  primaryAction: ReactNode;
  secondaryAction?: ReactNode;
  /** "Saved on this device" style reassurance. */
  autosaveNote?: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  screenId?: string;
  className?: string;
}

export function QuestionScreen({
  question,
  hint,
  back,
  progress,
  errorSummary,
  whyWeAsk,
  children,
  primaryAction,
  secondaryAction,
  autosaveNote,
  onSubmit,
  screenId,
  className,
}: QuestionScreenProps) {
  return (
    <section className={cx("md-question", className)} data-screen={screenId}>
      {back ? <div className="md-question__back">{back}</div> : null}
      {progress ? <div className="md-question__progress">{progress}</div> : null}
      {errorSummary}
      <form
        className="md-question__form"
        noValidate
        onSubmit={(event) => {
          if (onSubmit) onSubmit(event);
          else event.preventDefault();
        }}
      >
        <h1 className="md-question__title">{question}</h1>
        {hint ? <p className="md-question__hint">{hint}</p> : null}
        {whyWeAsk ? (
          <Disclosure className="md-why">
            <Disclosure.Heading className="md-why__heading">
              <Disclosure.Trigger className="md-why__trigger">
                <StatusGlyph kind="info" size={20} />
                <span>{whyWeAsk.label}</span>
                <Disclosure.Indicator className="md-why__indicator" />
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <Disclosure.Body className="md-why__body">{whyWeAsk.body}</Disclosure.Body>
            </Disclosure.Content>
          </Disclosure>
        ) : null}
        <div className="md-question__fields">{children}</div>
        <div className="md-question__actions">
          {primaryAction}
          {secondaryAction}
        </div>
        {autosaveNote ? <p className="md-question__autosave">{autosaveNote}</p> : null}
      </form>
    </section>
  );
}
