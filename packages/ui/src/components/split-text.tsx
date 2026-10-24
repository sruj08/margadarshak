"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { type CSSProperties, Fragment, type HTMLAttributes, useRef } from "react";
import { cx } from "../lib/cx";

gsap.registerPlugin(useGSAP);

export type SplitTextTag = "span" | "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export interface SplitTextProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  text: string;
  className?: string;
  /** Stagger delay between split units in milliseconds (React Bits convention). */
  delay?: number;
  /** Animation duration in seconds. */
  duration?: number;
  /** GSAP easing function. */
  ease?: string;
  /** Split granularity. Automatically falls back to "words" for Devanagari/Indic scripts. */
  splitType?: "chars" | "words";
  /** Initial GSAP tween vars. */
  from?: gsap.TweenVars;
  /** Target GSAP tween vars. */
  to?: gsap.TweenVars;
  /** HTML tag to render. Defaults to "span" so it can nest safely inside headings. */
  tag?: SplitTextTag;
  textAlign?: CSSProperties["textAlign"];
  onLetterAnimationComplete?: () => void;
}

const INDIC_SCRIPT_RE = /[\u0900-\u097F]/;

function shouldSkipMotion(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  const root = document.documentElement;
  if (root.getAttribute("data-lite") === "true" || root.getAttribute("data-motion") === "reduced") {
    return true;
  }
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return true;
  }
  return false;
}

const DEFAULT_FROM: gsap.TweenVars = { opacity: 0, y: 16 };
const DEFAULT_TO: gsap.TweenVars = { opacity: 1, y: 0 };

/**
 * React Bits `SplitText` (`@react-bits/SplitText-TS-CSS`) powered by GSAP.
 * Preserves exact `element.textContent` and automatically switches to word-level
 * splitting for Devanagari (`hi`, `doi`) so matras and shirorekha never fracture.
 */
export function SplitText({
  text,
  className,
  delay = 35,
  duration = 0.55,
  ease = "power3.out",
  splitType = "chars",
  from = DEFAULT_FROM,
  to = DEFAULT_TO,
  tag: Tag = "span",
  textAlign,
  onLetterAnimationComplete,
  style,
  ...rest
}: SplitTextProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const effectiveSplit: "chars" | "words" =
    splitType === "words" || INDIC_SCRIPT_RE.test(text) ? "words" : "chars";

  useGSAP(
    () => {
      const el = containerRef.current;
      if (!el || !text || shouldSkipMotion()) {
        return;
      }
      const targets = el.querySelectorAll<HTMLElement>(".rb-split-unit");
      if (targets.length === 0) {
        return;
      }

      const staggerSeconds = (effectiveSplit === "words" ? Math.max(delay, 45) : delay) / 1000;

      const tween = gsap.fromTo(
        targets,
        { ...from },
        {
          ...to,
          duration,
          ease,
          stagger: staggerSeconds,
          overwrite: "auto",
          onComplete: () => {
            gsap.set(targets, { clearProps: "transform,opacity,willChange" });
            onLetterAnimationComplete?.();
          },
        },
      );

      return () => {
        tween.kill();
      };
    },
    {
      dependencies: [text, delay, duration, ease, effectiveSplit],
      scope: containerRef,
    },
  );

  const words = text.split(" ");

  return (
    <Tag
      ref={containerRef as never}
      className={cx("rb-split-parent", className)}
      style={{ textAlign, ...style }}
      {...rest}
    >
      {words.map((word, wordIdx) => (
        <Fragment key={`${word}-${String(wordIdx)}`}>
          {effectiveSplit === "words" ? (
            <span className="rb-split-unit">{word}</span>
          ) : (
            <span className="rb-split-word">
              {Array.from(word).map((char, charIdx) => (
                <span
                  key={`${char}-${String(wordIdx)}-${String(charIdx)}`}
                  className="rb-split-unit"
                >
                  {char}
                </span>
              ))}
            </span>
          )}
          {wordIdx < words.length - 1 ? <span className="rb-split-space"> </span> : null}
        </Fragment>
      ))}
    </Tag>
  );
}
