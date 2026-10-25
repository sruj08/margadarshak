"use client";

import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";

interface SpringState {
  rx: number;
  ry: number;
  gx: number;
  gy: number;
  glare: number;
  scale: number;
}

const REST_SPRING: SpringState = {
  rx: 0,
  ry: 0,
  gx: 36,
  gy: 28,
  glare: 0.34,
  scale: 1,
};

function stepScalar(
  x: number,
  t: number,
  v: number,
  stiffness: number,
  damping: number,
  dt: number,
): [number, number, boolean] {
  const f = -stiffness * (x - t) - damping * v;
  const nv = v + f * dt;
  const nx = x + nv * dt;
  if (Math.abs(nx - t) > 0.015 || Math.abs(nv) > 0.015) {
    return [nx, nv, true];
  }
  return [t, 0, false];
}

function stepCardSprings(
  p: SpringState,
  t: SpringState,
  v: SpringState,
  dt: number,
): { moving: boolean } {
  const [rx, vrx, m1] = stepScalar(p.rx, t.rx, v.rx, 210, 21, dt);
  const [ry, vry, m2] = stepScalar(p.ry, t.ry, v.ry, 210, 21, dt);
  const [gx, vgx, m3] = stepScalar(p.gx, t.gx, v.gx, 180, 22, dt);
  const [gy, vgy, m4] = stepScalar(p.gy, t.gy, v.gy, 180, 22, dt);
  const [glare, vgl, m5] = stepScalar(p.glare, t.glare, v.glare, 180, 22, dt);
  const [scale, vsc, m6] = stepScalar(p.scale, t.scale, v.scale, 230, 24, dt);
  p.rx = rx;
  p.ry = ry;
  p.gx = gx;
  p.gy = gy;
  p.glare = glare;
  p.scale = scale;
  v.rx = vrx;
  v.ry = vry;
  v.gx = vgx;
  v.gy = vgy;
  v.glare = vgl;
  v.scale = vsc;
  return { moving: m1 || m2 || m3 || m4 || m5 || m6 };
}

function NationalEmblemSvg() {
  return (
    <svg viewBox="0 0 40 48" aria-hidden="true" className="md-dl-card__emblem-svg">
      <defs>
        <linearGradient id="dl-emblem-bronze" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d99b4e" />
          <stop offset="45%" stopColor="#9e5a16" />
          <stop offset="100%" stopColor="#5c2f06" />
        </linearGradient>
      </defs>
      {/* Side Lions in 3D relief */}
      <path
        d="M12.5 11.5c-2.2 0-3.8 1.6-3.8 3.7v6.2c0 1.4 1 2.6 2.3 2.9l1 5.7h16l1-5.7c1.3-.3 2.3-1.5 2.3-2.9v-6.2c0-2.1-1.6-3.7-3.8-3.7h-15Z"
        fill="url(#dl-emblem-bronze)"
        opacity="0.78"
      />
      {/* Central Lion & Mane in raised 3D bronze relief */}
      <path
        d="M20 3.5c-3 0-5.2 2.2-5.2 5v5.2h-2c-1.7 0-3 1.3-3 3v5c0 1.6 1.1 2.9 2.6 3.2l1.2 5.8h12.8l1.2-5.8c1.5-.3 2.6-1.6 2.6-3.2v-5c0-1.7-1.3-3-3-3h-2V8.5c0-2.8-2.2-5-5.2-5Z"
        fill="url(#dl-emblem-bronze)"
      />
      {/* Specular crown/mane highlight */}
      <path
        d="M17.2 6.8c1.5-1.1 4.1-1.1 5.6 0M16.5 11.2h7M15.8 15.5h8.4"
        stroke="#fde68a"
        strokeWidth="0.85"
        strokeLinecap="round"
        opacity="0.7"
      />
      {/* Abacus Pedestal + 3D Ashoka Dharma Chakra */}
      <rect x="8" y="31.2" width="24" height="5.4" rx="1.3" fill="url(#dl-emblem-bronze)" />
      <circle cx="20" cy="33.9" r="2.2" fill="#fffdf8" stroke="#78350f" strokeWidth="0.6" />
      <circle cx="20" cy="33.9" r="0.75" fill="#1e3a8a" />
      <path
        d="M20 31.8v4.2M17.9 33.9h4.2M18.5 32.4l3 3M21.5 32.4l-3 3"
        stroke="#1e3a8a"
        strokeWidth="0.45"
      />
      {/* Lotus bell base */}
      <path d="M6.8 37.4h26.4l-2.2 3H9l-2.2-3Z" fill="url(#dl-emblem-bronze)" opacity="0.92" />
    </svg>
  );
}

function MvdGearEmblemSvg({ className }: { className?: string }) {
  const teeth = Array.from({ length: 16 }, (_, i) => i * 22.5);
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      {teeth.map((deg) => (
        <rect
          key={deg}
          x="29.4"
          y="3"
          width="5.2"
          height="7"
          rx="1"
          fill="currentColor"
          transform={`rotate(${deg} 32 32)`}
        />
      ))}
      <circle cx="32" cy="32" r="22.5" fill="none" stroke="currentColor" strokeWidth="4.2" />
      <circle
        cx="32"
        cy="32"
        r="16.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.7"
      />
      {/* Steering wheel / MVD emblem triangle inside gear */}
      <circle cx="32" cy="32" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M24 30h16l-8 10.5L24 30Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="12.5" r="2.2" fill="#d97706" />
    </svg>
  );
}

function SmartCardChipSvg() {
  return (
    <svg viewBox="0 0 56 42" aria-hidden="true" className="md-dl-card__chip-svg">
      <rect
        x="1"
        y="1"
        width="54"
        height="40"
        rx="6"
        fill="url(#dl-chip-metal)"
        stroke="#8c5828"
        strokeWidth="1.15"
      />
      {/* Exact 6-pad SCOSTA smart chip layout matching reference */}
      <path
        d="M1 14.5h18.5M1 27.5h18.5M36.5 14.5H55M36.5 27.5H55M19.5 1v16.5c0 2 1.5 3.5 3.5 3.5h10c2 0 3.5-1.5 3.5-3.5V1M19.5 41V24.5c0-2 1.5-3.5 3.5-3.5h10c2 0 3.5 1.5 3.5 3.5V41M28 21v20"
        fill="none"
        stroke="#7c4a1e"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <defs>
        <linearGradient
          id="dl-chip-metal"
          x1="0"
          y1="0"
          x2="56"
          y2="42"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#f6cfa6" />
          <stop offset="48%" stopColor="#e5aa72" />
          <stop offset="100%" stopColor="#f3c798" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function CitizenAvatarSvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 78" aria-hidden="true" className={className}>
      {/* Steel-blue portrait backdrop */}
      <rect width="64" height="78" fill="#3a6b9c" />
      {/* Suit shoulders */}
      <path d="M4 78c2-17 13-24 28-24s26 7 28 24H4Z" fill="#2d3b45" />
      {/* White shirt & tie */}
      <path d="M23 53l9 18 9-18-9-3-9 3Z" fill="#ffffff" />
      <path d="M30.2 58h3.6l1.2 13-3 4-3-4 1.2-13Z" fill="#1e293b" />
      {/* Neck */}
      <rect x="26.5" y="43" width="11" height="12" rx="4" fill="#f2cbb2" />
      {/* Face */}
      <path
        d="M18.5 26c0-9 5.8-15 13.5-15s13.5 6 13.5 15v5.5c0 8.5-5.8 15.5-13.5 15.5S18.5 40 18.5 31.5V26Z"
        fill="#f7d5be"
      />
      {/* Hair */}
      <path
        d="M17.5 27c0-10.5 6-17.5 14.5-17.5S46.5 16.5 46.5 27c-1.8-5.2-5.5-7.2-14.5-7.2S19.3 21.8 17.5 27Z"
        fill="#3b2618"
      />
    </svg>
  );
}

function SignatureStrokeSvg({
  variant,
  seedText,
}: {
  variant: "authority" | "holder";
  seedText?: string;
}) {
  // Derive subtle signature Flourish variation when custom holder name is provided
  let lift = 14;
  let loop = 9;
  let tail = 26;
  if (variant === "holder" && seedText) {
    let h = 0;
    for (let i = 0; i < seedText.length; i++) {
      h = (h * 31 + seedText.charCodeAt(i)) | 0;
    }
    const abs = Math.abs(h);
    lift = 11 + (abs % 5);
    loop = 7 + ((abs >> 3) % 5);
    tail = 20 + ((abs >> 6) % 12);
  }

  return (
    <svg
      viewBox="0 0 86 24"
      aria-hidden="true"
      className={`md-dl-card__sig-svg md-dl-card__sig-svg--${variant}`}
    >
      {variant === "authority" ? (
        <path
          d="M4 19c6-7 13-14 16-14 2 0-2 11 1 11s8-9 11-9c2 0 0 7 3 7s5-4 8-4c2 0 3 3 7 3h31"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d={`M5 18c7-8 14-${lift} 17-${lift} 2.5 0-2 11 1.5 11 3 0 8-${loop} 11.5-${loop} 2.5 0 0 7 3.5 7 3 0 5-3.5 8-3.5 2.5 0 3.5 2.5 8 2.5h${tail}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export interface IndianDrivingLicenceCardProps {
  /** Custom holder name (displayed in uppercase on the card). */
  holderName?: string;
  /** Custom S/D/W guardian name. */
  guardianName?: string;
  /** Custom address line. */
  addressLine?: string;
  /** Custom PIN + status caption. */
  pinLine?: string;
  /** Custom DL number. */
  dlNumber?: string;
  /** Custom Date of Issue. */
  doi?: string;
  /** Custom Valid Till date. */
  validTill?: string;
  /** Custom Date of Birth. */
  dob?: string;
  /** Custom Blood Group. */
  bloodGroup?: string;
  /** Custom vehicle class codes (up to 2 rows displayed on the card face). */
  covCodes?: string[];
  /** Custom issuing authority caption. */
  issuingAuthority?: string;
  /** Whether the card is currently running its sleek card-loading / fabrication sequence. */
  isLoading?: boolean;
  /** Loading progress percentage (0..100). */
  loadProgress?: number;
  /** Current stage telemetry label shown on the card loader rail. */
  loadStageLabel?: string;
  /**
   * Progress mode (My Licence): the card is revealed left-to-right up to this percentage
   * (0..100), showing how close the holder is to the real licence. Lines that never change
   * from card to card (S/D/W, address, PIN, issuing authority) are left off.
   */
  revealProgress?: number;
}

/**
 * Authentic Indian Union Motor Driving Licence Smart Card (Form 7 · Rule 16(2)).
 * Pure rectangular card with brushed metallic finish, physics-based 3D hover tilt,
 * and optional Adobe-principle card-loading / laser-engraving state.
 */
export function IndianDrivingLicenceCard({
  holderName,
  guardianName,
  addressLine,
  pinLine,
  dlNumber,
  doi,
  validTill,
  dob,
  bloodGroup,
  covCodes,
  issuingAuthority,
  isLoading = false,
  loadProgress = 100,
  loadStageLabel,
  revealProgress,
}: IndianDrivingLicenceCardProps = {}) {
  const t = useTranslations("home.dlCard");
  const cardRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);
  const posRef = useRef<SpringState>({ ...REST_SPRING });
  const targetRef = useRef<SpringState>({ ...REST_SPRING });
  const velRef = useRef<SpringState>({ rx: 0, ry: 0, gx: 0, gy: 0, glare: 0, scale: 0 });
  const prevLoadingRef = useRef<boolean>(isLoading);

  const applyVars = (s: SpringState) => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty("--dl-rx", `${s.rx.toFixed(2)}deg`);
    el.style.setProperty("--dl-ry", `${s.ry.toFixed(2)}deg`);
    el.style.setProperty("--dl-gx", `${s.gx.toFixed(1)}%`);
    el.style.setProperty("--dl-gy", `${s.gy.toFixed(1)}%`);
    el.style.setProperty("--dl-glare", s.glare.toFixed(3));
    el.style.setProperty("--dl-scale", s.scale.toFixed(4));
    el.style.setProperty("--dl-sheen-pos", `${(50 + s.ry * 2.6 - s.rx * 1.8).toFixed(1)}%`);
    el.style.setProperty("--dl-sx", `${(-s.ry * 1.15).toFixed(1)}px`);
    el.style.setProperty("--dl-sy", `${(14 + s.rx * 1.05).toFixed(1)}px`);
  };

  const wake = () => {
    if (rafRef.current) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const { moving } = stepCardSprings(posRef.current, targetRef.current, velRef.current, dt);
      applyVars(posRef.current);
      rafRef.current = moving ? requestAnimationFrame(tick) : 0;
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only; applyVars only reads refs
  useEffect(() => {
    applyVars(posRef.current);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Give the card a subtle physical spring impulse when loading starts and when it finishes
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on isLoading changes only; wake reads refs
  useEffect(() => {
    if (isLoading && !prevLoadingRef.current) {
      targetRef.current = {
        rx: 0.6,
        ry: 0,
        gx: 50,
        gy: 50,
        glare: 0.52,
        scale: 0.992,
      };
      wake();
    } else if (!isLoading && prevLoadingRef.current) {
      velRef.current.scale = 0.22;
      velRef.current.ry = -18;
      targetRef.current = { ...REST_SPRING };
      wake();
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading]);

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const py = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const nx = (px - 0.5) * 2;
    const ny = (py - 0.5) * 2;

    targetRef.current = {
      rx: -ny * 10.5,
      ry: nx * 13.5,
      gx: px * 100,
      gy: py * 100,
      glare: 0.62,
      scale: 1.018,
    };
    wake();
  };

  const handlePointerLeave = () => {
    targetRef.current = { ...REST_SPRING };
    wake();
  };

  const resolvedName = (holderName?.trim() || t("nameVal")).toUpperCase();
  const resolvedGuardian = (guardianName?.trim() || t("sdwVal")).toUpperCase();
  const resolvedAddress = (addressLine?.trim() || t("addVal")).toUpperCase();
  const resolvedPin = (pinLine?.trim() || t("pinVal")).toUpperCase();
  const resolvedDlNo = dlNumber?.trim() || t("dlNoVal");
  const resolvedDoi = doi?.trim() || t("doiVal");
  const resolvedValidTill = validTill?.trim() || t("validTillVal");
  const resolvedDob = dob?.trim() || t("dobVal");
  const resolvedBg = bloodGroup?.trim() || t("bgVal");
  const resolvedIssuing = issuingAuthority?.trim() || t("issuingSign");
  const covPrimary = covCodes && covCodes.length > 0 ? covCodes[0] : t("lmv");
  const covSecondary =
    covCodes && covCodes.length > 1
      ? covCodes[1]
      : covCodes && covCodes.length === 1
        ? null
        : t("mcwg");

  const progressive = revealProgress !== undefined;
  const clampedProgress = Math.max(0, Math.min(100, progressive ? revealProgress : loadProgress));
  // In progress mode the left-to-right reveal mask does the work, so no per-zone blur.
  const stageChipReady = progressive || !isLoading || clampedProgress >= 22;
  const stageMetaReady = progressive || !isLoading || clampedProgress >= 52;
  const stageHolderReady = progressive || !isLoading || clampedProgress >= 78;
  const showLoader = progressive ? clampedProgress < 100 : isLoading;

  return (
    <div className="md-dl-stage" data-testid="indian-dl-showcase">
      <div
        ref={cardRef}
        className={`md-dl-card${showLoader ? " md-dl-card--loading" : ""}${progressive ? " md-dl-card--progressive" : ""}`}
        data-testid="dl-smart-card"
        data-loading={showLoader ? "true" : "false"}
        role="img"
        aria-label={`${t("regionLabel")} — ${resolvedName}`}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        style={
          {
            "--dl-rx": "0deg",
            "--dl-ry": "0deg",
            "--dl-gx": "36%",
            "--dl-gy": "28%",
            "--dl-glare": "0.34",
            "--dl-scale": "1",
            "--dl-sheen-pos": "41%",
            "--dl-sx": "4px",
            "--dl-sy": "16px",
            "--dl-load-pct": `${clampedProgress.toFixed(1)}%`,
          } as CSSProperties
        }
      >
        {/* Brushed Metallic Sheen + Optical Specular Glare */}
        <div className="md-dl-card__metal-grain" aria-hidden="true" />
        <div className="md-dl-card__sheen" aria-hidden="true" />
        <div className="md-dl-card__glare" aria-hidden="true" />

        {/* Laser-Engraving Scanline & Sleek Bottom Card-Loading Rail when isLoading */}
        {showLoader ? (
          <>
            <div className="md-dl-card__laser-beam" aria-hidden="true" />
            <div className="md-dl-card__load-rail" aria-hidden="true">
              <div className="md-dl-card__load-rail-meta">
                {loadStageLabel ? (
                  <span className="md-dl-card__load-rail-stage">{loadStageLabel}</span>
                ) : null}
                <span className="md-dl-card__load-rail-pct">{Math.round(clampedProgress)}%</span>
              </div>
              <div className="md-dl-card__load-rail-track">
                <span
                  className="md-dl-card__load-rail-fill"
                  style={{ width: `${clampedProgress}%` }}
                />
              </div>
            </div>
          </>
        ) : null}

        {/* Centered MVD Gear Watermark */}
        <div className="md-dl-card__watermark" aria-hidden="true">
          <MvdGearEmblemSvg />
        </div>

        {/* Top Header Row: National Emblem + Crimson Union Banner + MVD Gear Crest */}
        <header className="md-dl-card__top">
          <div className="md-dl-card__emblem">
            <NationalEmblemSvg />
            <span className="md-dl-card__motto">सत्यमेव जयते</span>
          </div>

          <div className="md-dl-card__banner">
            <span className="md-dl-card__banner-top">{t("unionTop")}</span>
            <span className="md-dl-card__banner-main">{t("unionTitle")}</span>
          </div>

          <div className="md-dl-card__crest">
            <MvdGearEmblemSvg className="md-dl-card__crest-svg" />
          </div>
        </header>

        {/* Main 2-Zone Body: Left/Center Credentials + Right Portrait Stack */}
        <div className="md-dl-card__content">
          <div className="md-dl-card__main-col">
            {/* Upper Dates & Licence Number */}
            <div
              className={`md-dl-card__dates-row${!stageMetaReady ? " md-dl-card__zone--etching" : ""}`}
            >
              <div className="md-dl-card__dl-block">
                <div className="md-dl-card__kv">
                  <span className="md-dl-card__k">{t("dlNo")}</span>{" "}
                  <strong
                    className="md-dl-card__v md-dl-card__v--mono"
                    data-testid="dl-card-number"
                  >
                    {resolvedDlNo}
                  </strong>
                </div>
                <div className="md-dl-card__kv">
                  <span className="md-dl-card__k">{t("validTill")}</span>{" "}
                  <strong className="md-dl-card__v">{resolvedValidTill}</strong>
                </div>
              </div>

              <div className="md-dl-card__doi-block">
                <div className="md-dl-card__kv">
                  <span className="md-dl-card__k">{t("doi")}</span>{" "}
                  <strong className="md-dl-card__v">{resolvedDoi}</strong>
                </div>
                <div className="md-dl-card__kv">
                  <span className="md-dl-card__k">{t("dlr")}</span>{" "}
                  <strong className="md-dl-card__v">{resolvedDoi}</strong>
                </div>
              </div>
            </div>

            {/* Middle Row: Golden Smart Chip on Left + COV Table in Center */}
            <div className="md-dl-card__mid-row">
              <div
                className={`md-dl-card__chip-wrap${!stageChipReady ? " md-dl-card__zone--etching" : ""}`}
              >
                <SmartCardChipSvg />
              </div>

              <div
                className={`md-dl-card__auth-block${!stageMetaReady ? " md-dl-card__zone--etching" : ""}`}
              >
                <p className="md-dl-card__auth-title">{t("authHeading")}</p>
                <div className="md-dl-card__cov-table">
                  <span className="md-dl-card__cov-th">{t("cov")}</span>
                  <span className="md-dl-card__cov-th">{t("doi").replace(":", "")}</span>
                  <strong className="md-dl-card__cov-td">{covPrimary}</strong>
                  <strong className="md-dl-card__cov-td">{resolvedDoi}</strong>
                  {covSecondary ? (
                    <>
                      <strong className="md-dl-card__cov-td">{covSecondary}</strong>
                      <strong className="md-dl-card__cov-td">{resolvedDoi}</strong>
                    </>
                  ) : null}
                </div>
                <div className="md-dl-card__dob-row">
                  <span>
                    <em className="md-dl-card__k">{t("dob")}</em> <strong>{resolvedDob}</strong>
                  </span>
                  <span>
                    <em className="md-dl-card__k">{t("bg")}</em> <strong>{resolvedBg}</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom-Left Holder Details & Issuing Authority Signature */}
            <div
              className={`md-dl-card__holder-block${!stageHolderReady ? " md-dl-card__zone--etching" : ""}`}
            >
              <div className="md-dl-card__holder-lines">
                <div>
                  <span className="md-dl-card__k">{t("nameLabel")} :</span>{" "}
                  <strong className="md-dl-card__holder-name" data-testid="dl-card-holder-name">
                    {resolvedName}
                  </strong>
                </div>
                {progressive ? null : (
                  <>
                    <div>
                      <span className="md-dl-card__k">{t("sdwLabel")}:</span>{" "}
                      <strong>{resolvedGuardian}</strong>
                    </div>
                    <div>
                      <span className="md-dl-card__k">{t("addLabel")}:</span>{" "}
                      <strong>{resolvedAddress}</strong>
                    </div>
                  </>
                )}
              </div>

              {progressive ? null : (
                <div className="md-dl-card__authority-row">
                  <div className="md-dl-card__authority-text">
                    <div>
                      <span className="md-dl-card__k">{t("pinLabel")}</span>{" "}
                      <strong>{resolvedPin}</strong>
                    </div>
                    <div className="md-dl-card__sig-caption">{resolvedIssuing}</div>
                  </div>
                  <SignatureStrokeSvg variant="authority" />
                </div>
              )}
            </div>
          </div>

          {/* Right Portrait & Holder Signature Column */}
          <div
            className={`md-dl-card__photo-col${!stageHolderReady ? " md-dl-card__zone--etching" : ""}`}
          >
            <div className="md-dl-card__form-rule">
              <span>{t("formRule1")}</span>
              <span>{t("formRule2")}</span>
            </div>

            <div className="md-dl-card__photo-main">
              <CitizenAvatarSvg className="md-dl-card__avatar-svg" />
            </div>

            <div className="md-dl-card__photo-mini">
              <CitizenAvatarSvg className="md-dl-card__avatar-mini-svg" />
            </div>

            <div className="md-dl-card__holder-sig">
              <SignatureStrokeSvg variant="holder" seedText={resolvedName} />
              <span className="md-dl-card__sig-caption">{t("holderSign")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
