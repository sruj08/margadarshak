"use client";

import { Description, FieldError, DateField as HeroDateField, Label } from "@heroui/react";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * DateField (DESIGN_SYSTEM §11.2): segmented Day · Month · Year entry, no picker for a date of birth.
 * Segment order follows the active locale (en-IN / hi-IN = day first). 56 px tall, 1.5 px
 * --md-border-strong outline (WCAG 1.4.11). Errors read "what is wrong + how to fix it".
 */
type HeroDateFieldProps = ComponentProps<typeof HeroDateField>;

export interface DateFieldProps extends Omit<HeroDateFieldProps, "children" | "className"> {
  label: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  className?: string;
}

export function DateField({
  label,
  description,
  errorMessage,
  className,
  ...rest
}: DateFieldProps) {
  return (
    <HeroDateField className={cx("md-field md-date", className)} {...rest}>
      <Label className="md-field__label">{label}</Label>
      {description ? <Description className="md-field__hint">{description}</Description> : null}
      <HeroDateField.Group className="md-date__group">
        <HeroDateField.Input className="md-date__input">
          {(segment) => <HeroDateField.Segment segment={segment} className="md-date__segment" />}
        </HeroDateField.Input>
      </HeroDateField.Group>
      {errorMessage ? <FieldError className="md-field__error">{errorMessage}</FieldError> : null}
    </HeroDateField>
  );
}
