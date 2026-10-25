"use client";

import { Disclosure } from "@heroui/react";
import { Button } from "@margdarshak/ui/components/button";
import { type LanguageOption, LanguagePicker } from "@margdarshak/ui/components/language-picker";
import { useState } from "react";
import { BrandMark } from "@/components/shell/brand-mark";
import { COOKIE_WELCOMED, rememberLanguage } from "@/lib/prefs/device";

interface Props {
  brandName: string;
  current: string;
  titles: { lang: string; text: string }[];
  hint: string;
  options: LanguageOption[];
  more: { label: string; body: string };
  cta: string;
}

function hasCookie(name: string): boolean {
  return document.cookie.split(/;\s*/).some((c) => c.startsWith(`${name}=`));
}

/**
 * Pre-selects the language the proxy suggested (from the URL / Accept-Language) but never continues
 * on its own. Continue stores the choice for a year and goes to the launch notice once per device.
 */
export function LanguageScreen({ brandName, current, titles, hint, options, more, cta }: Props) {
  const [value, setValue] = useState<string>(current);
  const [busy, setBusy] = useState(false);
  const labelledBy = titles.map((_, i) => `lang-title-${i}`).join(" ");

  return (
    <section className="md-onboard">
      <div className="md-hero__glow" aria-hidden="true" />
      <BrandMark name={brandName} locale={current} variant="mark" />
      <div className="md-onboard__titles">
        {titles.map((title, i) =>
          i === 0 ? (
            <h1 key={title.lang} id={`lang-title-${i}`} lang={title.lang} className="md-h1">
              {title.text}
            </h1>
          ) : (
            <p
              key={title.lang}
              id={`lang-title-${i}`}
              lang={title.lang}
              className="md-onboard__title-alt"
            >
              {title.text}
            </p>
          ),
        )}
      </div>
      <p className="md-lead">{hint}</p>
      <LanguagePicker options={options} value={value} onChange={setValue} labelledBy={labelledBy} />
      <Disclosure className="md-more">
        <Disclosure.Heading>
          <Disclosure.Trigger className="md-more__trigger">
            <span>{more.label}</span>
            <Disclosure.Indicator />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content>
          <Disclosure.Body className="md-more__body">{more.body}</Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
      <Button
        variant="primary"
        size="lg"
        className="md-onboard__cta"
        isPending={busy}
        onPress={() => {
          const locale = value === "hi" ? "hi" : "en";
          setBusy(true);
          rememberLanguage(locale);
          const next = hasCookie(COOKIE_WELCOMED) ? `/${locale}` : `/${locale}/welcome`;
          window.location.assign(next);
        }}
      >
        {cta}
      </Button>
    </section>
  );
}
