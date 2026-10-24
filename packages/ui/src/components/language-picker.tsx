"use client";

import { Description, Radio, RadioGroup } from "@heroui/react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * LanguagePicker (C-01, SCR-001): each language in its own script with its English name beneath.
 * Every option carries its own `lang` so screen readers switch voice. Selection never auto-continues;
 * the screen's Continue button commits the choice.
 */
export interface LanguageOption {
  code: string;
  /** Name in its own script: "हिन्दी", "English". */
  nativeName: string;
  /** Name in English (shown only when it differs from the native name). */
  englishName?: string;
  /** BCP 47 tag for the native name, e.g. "hi". */
  lang: string;
  /** Extra line, e.g. "Speak in Dogri; screens show Hindi". */
  caption?: ReactNode;
  captionLang?: string;
  /** Listed honestly but not selectable yet (e.g. Dogri: voice input only). */
  disabled?: boolean;
}

export interface LanguagePickerProps {
  options: readonly LanguageOption[];
  value: string | null;
  onChange: (code: string) => void;
  /** id(s) of the visible heading(s) that label the group (bilingual titles). */
  labelledBy: string;
  variant?: "screen0" | "settings";
  className?: string;
}

export function LanguagePicker({
  options,
  value,
  onChange,
  labelledBy,
  variant = "screen0",
  className,
}: LanguagePickerProps) {
  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      value={value}
      onChange={onChange}
      className={cx("md-lang", `md-lang--${variant}`, className)}
    >
      {options.map((o) => (
        <Radio
          key={o.code}
          value={o.code}
          isDisabled={o.disabled ?? false}
          className="md-lang__option"
        >
          <Radio.Content className="md-lang__content">
            <Radio.Control className="md-lang__control">
              <Radio.Indicator />
            </Radio.Control>
            <span className="md-lang__names">
              <span className="md-lang__native" lang={o.lang}>
                {o.nativeName}
              </span>
              {o.englishName && o.englishName !== o.nativeName ? (
                <span className="md-lang__english" lang="en">
                  {o.englishName}
                </span>
              ) : null}
            </span>
          </Radio.Content>
          {o.caption ? (
            <Description
              className="md-lang__caption"
              {...(o.captionLang ? { lang: o.captionLang } : {})}
            >
              {o.caption}
            </Description>
          ) : null}
        </Radio>
      ))}
    </RadioGroup>
  );
}
