/**
 * IL-01 "dawn road" (DESIGN_SYSTEM §7): a road vanishing towards sunrise. Flat shapes, no outlines,
 * one sky glow, at most six colours, all from tokens so it follows light/dark/high-contrast.
 * Decorative: always aria-hidden.
 */
export function DawnRoad({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 240 150"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <defs>
        <radialGradient id="md-dawn-sun" cx="50%" cy="78%" r="55%">
          <stop offset="0%" stopColor="var(--md-nazar)" stopOpacity="0.95" />
          <stop offset="45%" stopColor="var(--md-ember)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--md-peri)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="240" height="150" rx="20" fill="var(--md-mist)" />
      <rect width="240" height="150" rx="20" fill="url(#md-dawn-sun)" />
      <circle cx="120" cy="86" r="17" fill="var(--md-ember)" opacity="0.85" />
      <path
        d="M0 92 C 50 78, 80 84, 120 88 C 160 84, 200 76, 240 90 V150 H0Z"
        fill="var(--md-topic-night)"
      />
      <path
        d="M0 104 C 60 94, 90 98, 120 100 C 150 98, 190 92, 240 104 V150 H0Z"
        fill="var(--md-topic-signs)"
      />
      <path d="M113 92 H127 L176 150 H64 Z" fill="var(--md-road)" />
      <path
        d="M119.4 98 h1.2 l1.1 9 h-3.4z M118.6 114 h2.8 l1.4 12 h-5.6z M117.6 133 h4.8 l1.8 17 h-8.4z"
        fill="var(--md-on-road)"
        opacity="0.7"
      />
    </svg>
  );
}
