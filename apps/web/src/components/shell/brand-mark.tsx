/**
 * Wordmark with the dawn dot (DESIGN_SYSTEM §2): Fraunces 600, the dot sits above the "a" of "Marg".
 * No emblem, no tricolour, no government lettering (D-01).
 */
export function BrandMark({ name, locale }: { name: string; locale: string }) {
  return (
    <span className="md-brand" lang={locale === "hi" ? "hi" : "en"}>
      <span className="md-brand__dot" aria-hidden="true" />
      <span className="md-brand__word">{name}</span>
    </span>
  );
}
