"use client";

import { Checkbox, Description, Radio, RadioGroup } from "@heroui/react";
import type { ReactNode } from "react";

/**
 * ChoiceCards: a radio group rendered as 56 px+ cards (one question per screen). The group is
 * labelled by the page's h1 (`labelledBy`), each option has a label and an optional description.
 * Nothing is pre-selected unless the caller passes a value.
 */
export interface Choice {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  disabled?: boolean;
  lang?: string;
}

export function ChoiceCards({
  choices,
  value,
  onChange,
  labelledBy,
  describedBy,
  name,
  invalid,
}: {
  choices: readonly Choice[];
  value: string | null;
  onChange: (id: string) => void;
  labelledBy: string;
  describedBy?: string;
  name?: string;
  invalid?: boolean;
}) {
  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
      value={value}
      onChange={onChange}
      {...(name ? { name } : {})}
      isInvalid={invalid ?? false}
      className="mj-choices"
    >
      {choices.map((c) => (
        <Radio key={c.id} value={c.id} isDisabled={c.disabled ?? false} className="mj-choice">
          <Radio.Content className="mj-choice__content">
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            <span className="mj-choice__text" {...(c.lang ? { lang: c.lang } : {})}>
              <span className="mj-choice__label">{c.label}</span>
              {c.description ? <span className="mj-choice__desc">{c.description}</span> : null}
            </span>
            {c.aside ? <span className="mj-choice__aside">{c.aside}</span> : null}
          </Radio.Content>
        </Radio>
      ))}
    </RadioGroup>
  );
}

/** A single checkbox row (consent, "I've checked these answers"). Never pre-ticked. */
export function CheckRow({
  checked,
  onChange,
  children,
  description,
  invalid,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  description?: ReactNode;
  invalid?: boolean;
  id?: string;
}) {
  return (
    <Checkbox
      isSelected={checked}
      onChange={onChange}
      isInvalid={invalid ?? false}
      className="mj-check"
      {...(id ? { id } : {})}
    >
      <Checkbox.Content className="mj-check-row">
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        <span className="mj-choice__text">
          <span className="mj-choice__label">{children}</span>
          {description ? (
            <Description className="mj-choice__desc mj-check__desc">{description}</Description>
          ) : null}
        </span>
      </Checkbox.Content>
    </Checkbox>
  );
}
