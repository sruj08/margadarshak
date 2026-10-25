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

/**
 * `compact` (the top bar) falls back to the symbol alone on narrow phones, where the full lockup
 * would not fit beside the language switch and settings.
 */
export function BrandMark({
  name,
  locale,
  variant = "horizontal",
  compact = false,
}: {
  name: string;
  locale: string;
  variant?: Variant;
  compact?: boolean;
}) {
  const isIndic = locale !== "en";
  const lang = isIndic ? locale : "en";
  const art: Variant = isIndic ? "mark" : variant;
  const withName = art === "mark" && variant !== "mark";
  const alt = withName ? "" : name;
  const narrow = compact && art === "horizontal";
  return (
    <span
      className={`md-brand md-brand--${variant}${compact ? " md-brand--compact" : ""}`}
      lang={lang}
      data-art={art}
    >
      <Art art={art} alt={alt} extra={narrow ? "md-brand__art--wide" : ""} />
      {narrow ? <Art art="mark" alt={alt} extra="md-brand__art--narrow" /> : null}
      {withName ? <span className="md-brand__word">{name}</span> : null}
    </span>
  );
}

function Art({ art, alt, extra }: { art: Variant; alt: string; extra: string }) {
  const { file, width, height } = ART[art];
  return (
    <>
      <img
        className={`md-brand__art md-brand__art--light ${extra}`}
        src={`/brand/margdarshak-${file}-light.svg`}
        alt={alt}
        width={width}
        height={height}
        decoding="async"
      />
      <img
        className={`md-brand__art md-brand__art--dark ${extra}`}
        src={`/brand/margdarshak-${file}-dark.svg`}
        alt={alt}
        width={width}
        height={height}
        decoding="async"
      />
    </>
  );
}
