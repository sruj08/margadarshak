"use client";

import { useFormatter } from "next-intl";
import { useId } from "react";

/** A one-decimal number formatter in the page locale. */
export function useNum(): (n: number) => string {
  const f = useFormatter();
  return (n: number) => f.number(n, { maximumFractionDigits: 1 });
}

/**
 * Big slider plus ± buttons, both always present (UI_SPEC_LEARN_GAMES §5.2, tap-only): the buttons
 * are the no-drag path, the slider is for sighted touch users and keyboards (arrow keys).
 */
export function Stepper(p: {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Button steps, smallest first, e.g. [1, 10]. */
  steps: readonly number[];
  sliderStep: number;
  unit: (v: number) => string;
  /** Accessible names of the step buttons. */
  less: (s: number) => string;
  more: (s: number) => string;
  onChange(v: number): void;
  disabled?: boolean;
  testId: string;
}) {
  const id = useId();
  const set = (v: number) => p.onChange(Math.max(p.min, Math.min(p.max, v)));
  const desc = [...p.steps].reverse();
  return (
    <fieldset className="sd-stepper" data-testid={p.testId} disabled={p.disabled}>
      <legend className="sd-stepper__label" id={`${id}-l`}>
        {p.label}
      </legend>
      <output className="sd-stepper__value" aria-live="polite" data-testid={`${p.testId}-value`}>
        {p.unit(p.value)}
      </output>
      <input
        type="range"
        className="sd-stepper__range"
        min={p.min}
        max={p.max}
        step={p.sliderStep}
        value={p.value}
        aria-labelledby={`${id}-l`}
        aria-valuetext={p.unit(p.value)}
        onChange={(e) => set(Number(e.currentTarget.value))}
        data-testid={`${p.testId}-range`}
      />
      <div className="sd-stepper__btns">
        {desc.map((s) => (
          <button
            key={`m${s}`}
            type="button"
            className="sd-stepper__btn"
            aria-label={p.less(s)}
            onClick={() => set(p.value - s)}
            data-testid={`${p.testId}-minus-${s}`}
          >
            −{s}
          </button>
        ))}
        {p.steps.map((s) => (
          <button
            key={`p${s}`}
            type="button"
            className="sd-stepper__btn"
            aria-label={p.more(s)}
            onClick={() => set(p.value + s)}
            data-testid={`${p.testId}-plus-${s}`}
          >
            +{s}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
