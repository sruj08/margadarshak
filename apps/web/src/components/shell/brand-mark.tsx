/**
 * Margdarshak logo, "The Seeing Wheel" (public/brand): a steering arch over a road chevron with the
 * nazar orb. No emblem, no tricolour, no government lettering (D-01).
 *
 * Both colourways are rendered and CSS shows the one for the active theme (data-theme, else the OS),
 * so the logo flips with the page and never flashes. The lockups carry a Latin wordmark, so Hindi
 * pairs the symbol with the Devanagari name instead.
 */
type Variant = "horizontal" | "stacked" | "mark";

const ART = {
  horizontal: { file: "horizontal", width: 1840, height: 480 },
  stacked: { file: "logo", width: 1024, height: 1024 },
  mark: { file: "mark", width: 1024, height: 1024 },
} as const;

export function BrandMark({
  name,
  locale,
  variant = "horizontal",
}: {
  name: string;
  locale: string;
  variant?: Variant;
}) {
  const lang = locale === "hi" ? "hi" : "en";
  const art: Variant = lang === "hi" ? "mark" : variant;
  const withName = art === "mark" && variant !== "mark";
  const { file, width, height } = ART[art];
  const alt = withName ? "" : name;
  return (
    <span className={`md-brand md-brand--${variant}`} lang={lang} data-art={art}>
      <img
        className="md-brand__art md-brand__art--light"
        src={`/brand/margdarshak-${file}-light.svg`}
        alt={alt}
        width={width}
        height={height}
        decoding="async"
      />
      <img
        className="md-brand__art md-brand__art--dark"
        src={`/brand/margdarshak-${file}-dark.svg`}
        alt={alt}
        width={width}
        height={height}
        decoding="async"
      />
      {withName ? <span className="md-brand__word">{name}</span> : null}
    </span>
  );
}
