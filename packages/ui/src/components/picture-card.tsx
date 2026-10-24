"use client";

import { Checkbox, CheckboxGroup, Description, Label, Radio, RadioGroup } from "@heroui/react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * PictureCard group (PictureChoice, SCR-011): pictures first, legal class names second. The whole card
 * is the hit area (>= 48 px, usually ~120 px). Single choice uses a radio group, multiple choice a
 * checkbox group; arrow keys / space work as React Aria defines. Selected = primary-soft ground + check.
 */
export interface PictureOption {
  id: string;
  label: ReactNode;
  caption?: ReactNode;
  /** Decorative pictogram (aria-hidden SVG). */
  picture: ReactNode;
  /** Shown as a reason when the option cannot be chosen (stays focusable, aria-disabled). */
  disabledReason?: ReactNode;
  lang?: string;
}

interface BaseProps {
  label: ReactNode;
  description?: ReactNode;
  options: readonly PictureOption[];
  className?: string;
  name?: string;
}

export interface PictureCardSingleProps extends BaseProps {
  selectionMode?: "single";
  value?: string | null;
  defaultValue?: string;
  onChange?: (value: string) => void;
}

export interface PictureCardMultipleProps extends BaseProps {
  selectionMode: "multiple";
  value?: string[];
  defaultValue?: string[];
  onChange?: (value: string[]) => void;
}

function CardBody({ option }: { option: PictureOption }) {
  return (
    <span className="md-pick__body">
      <span className="md-pick__picture" aria-hidden="true">
        {option.picture}
      </span>
      <span className="md-pick__label" lang={option.lang}>
        {option.label}
      </span>
      {option.caption ? <span className="md-pick__caption">{option.caption}</span> : null}
      {option.disabledReason ? (
        <span className="md-pick__reason">{option.disabledReason}</span>
      ) : null}
    </span>
  );
}

export function PictureCardGroup(props: PictureCardSingleProps | PictureCardMultipleProps) {
  const { label, description, options, className, name } = props;
  const groupClass = cx("md-pick-group", className);
  const head = (
    <>
      <Label className="md-pick-group__label">{label}</Label>
      {description ? (
        <Description className="md-pick-group__desc">{description}</Description>
      ) : null}
    </>
  );

  if (props.selectionMode === "multiple") {
    return (
      <CheckboxGroup
        className={groupClass}
        {...(name ? { name } : {})}
        {...(props.value ? { value: props.value } : {})}
        {...(props.defaultValue ? { defaultValue: props.defaultValue } : {})}
        {...(props.onChange ? { onChange: props.onChange } : {})}
      >
        {head}
        <div className="md-pick-grid">
          {options.map((o) => (
            <Checkbox
              key={o.id}
              value={o.id}
              isDisabled={Boolean(o.disabledReason)}
              className="md-pick"
            >
              <Checkbox.Content className="md-pick__content">
                <Checkbox.Control className="md-pick__control">
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <CardBody option={o} />
              </Checkbox.Content>
            </Checkbox>
          ))}
        </div>
      </CheckboxGroup>
    );
  }

  return (
    <RadioGroup
      className={groupClass}
      {...(name ? { name } : {})}
      {...(props.value !== undefined ? { value: props.value } : {})}
      {...(props.defaultValue ? { defaultValue: props.defaultValue } : {})}
      {...(props.onChange ? { onChange: props.onChange } : {})}
    >
      {head}
      <div className="md-pick-grid">
        {options.map((o) => (
          <Radio key={o.id} value={o.id} isDisabled={Boolean(o.disabledReason)} className="md-pick">
            <Radio.Content className="md-pick__content">
              <Radio.Control className="md-pick__control">
                <Radio.Indicator />
              </Radio.Control>
              <CardBody option={o} />
            </Radio.Content>
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}
