/**
 * Third-party marks for the simulated screens. Drawn for this prototype in the services' colours so
 * people recognise the step; they are not the trademarked artwork (D-01, D-19).
 */
export function DigiLockerMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      className="fx-mark"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="fx-dl-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f6fe4" />
          <stop offset="1" stopColor="#1a3f9c" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="url(#fx-dl-g)" />
      <path
        d="M12.5 27.5h15.2a5.3 5.3 0 0 0 .6-10.56A7.3 7.3 0 0 0 14.3 15a6.3 6.3 0 0 0-1.8 12.5Z"
        fill="#fff"
      />
      <rect x="16.4" y="19.6" width="7.2" height="5.8" rx="1.3" fill="#1f4fb8" />
      <path
        d="M17.9 19.6v-1.5a2.1 2.1 0 0 1 4.2 0v1.5"
        fill="none"
        stroke="#1f4fb8"
        strokeWidth="1.4"
      />
      <circle cx="20" cy="22.4" r="0.95" fill="#fff" />
    </svg>
  );
}

/** Aadhaar step glyph: a sun-and-fingerprint motif in saffron (not the UIDAI logo). */
export function AadhaarMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      className="fx-mark"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="40" height="40" rx="10" fill="#fff7ed" />
      <g fill="none" stroke="#ea580c" strokeWidth="1.6" strokeLinecap="round">
        <path d="M13.5 22c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
        <path d="M16.2 26.5c-.4-1.4-.6-2.9-.6-4.5a4.4 4.4 0 0 1 8.8 0c0 2.2-.3 4.2-.9 6" />
        <path d="M20 22v4.5" />
        <path d="M11 17.5a10.5 10.5 0 0 1 18 0" />
      </g>
      <g stroke="#dc2626" strokeWidth="1.4" strokeLinecap="round">
        <path d="M20 7.5v2.2M13.4 9.3l1.1 1.9M26.6 9.3l-1.1 1.9" />
      </g>
    </svg>
  );
}
