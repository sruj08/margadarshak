"use client";

import { ProgressBar as HeroProgressBar, Label } from "@heroui/react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { StatusGlyph } from "./status-glyph";

/**
 * Stepper (GOV.UK step-by-step, C-06 strip) and ProgressBar. Status is glyph + word, never colour
 * alone: done (check), now (amber dot in a ring), later (hollow ring). The current step carries
 * aria-current="step".
 */
export type StepStatus = "done" | "now" | "later";

export interface StepItem {
  id: string;
  label: ReactNode;
  status: StepStatus;
  /** Optional meta line: a date or a fee. */
  meta?: ReactNode;
}

export interface StepperProps {
  steps: readonly StepItem[];
  /** Localised status words, e.g. { done: "Done", now: "Now", later: "Later" }. */
  statusLabels: Record<StepStatus, string>;
  /** Accessible name of the list, e.g. "Your licence journey". */
  label: string;
  orientation?: "vertical" | "horizontal";
  className?: string;
}

export function Stepper({
  steps,
  statusLabels,
  label,
  orientation = "vertical",
  className,
}: StepperProps) {
  return (
    <ol aria-label={label} className={cx("md-stepper", `md-stepper--${orientation}`, className)}>
      {steps.map((step) => (
        <li
          key={step.id}
          className={cx("md-stepper__step", `md-stepper__step--${step.status}`)}
          aria-current={step.status === "now" ? "step" : undefined}
        >
          <span className="md-stepper__marker">
            <StatusGlyph kind={step.status} size={24} />
          </span>
          <span className="md-stepper__text">
            <span className="md-stepper__label">{step.label}</span>
            <span className="md-stepper__status">{statusLabels[step.status]}</span>
            {step.meta ? <span className="md-stepper__meta">{step.meta}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface ProgressBarProps {
  /** Visible label, e.g. "Question 2 of 6". */
  label: string;
  value: number;
  max?: number;
  /** Visible value text; defaults to none (the label already says it). */
  valueText?: string;
  className?: string;
}

export function ProgressBar({ label, value, max = 100, valueText, className }: ProgressBarProps) {
  return (
    <HeroProgressBar
      value={value}
      maxValue={max}
      className={cx("md-progress", className)}
      {...(valueText ? { valueLabel: valueText } : {})}
    >
      <div className="md-progress__row">
        <Label className="md-progress__label">{label}</Label>
        {valueText ? <HeroProgressBar.Output className="md-progress__value" /> : null}
      </div>
      <HeroProgressBar.Track className="md-progress__track">
        <HeroProgressBar.Fill className="md-progress__fill" />
      </HeroProgressBar.Track>
    </HeroProgressBar>
  );
}
