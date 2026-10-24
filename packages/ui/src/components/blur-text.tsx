"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Fragment, type HTMLAttributes, useRef } from "react";
import { cx } from "../lib/cx";

gsap.registerPlugin(useGSAP);

export type BlurTextTag = "p" | "span" | "div";

export interface BlurTextProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  text: string;
  /** Stagger delay between words/letters in milliseconds (React Bits convention). */
  delay?: number;
  /** Animation duration in seconds per unit. */
  duration?: number;
  animateBy?: "words" | "letters";
  direction?: "top" | "bottom";
  tag?: BlurTextTag;
  onAnimationComplete?: () => void;
}

const INDIC_SCRIPT_RE = /[\u0900-\u097F]/;

function shouldSkipBlurMotion(): boolean {
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

/**
 * React Bits `BlurText` (`@react-bits/BlurText-TS-CSS`) powered by GSAP.
 * Soft-focus word/character reveal for hero subtitles and lead copy.
 */
export function BlurText({
  text,
  delay = 45,
  duration = 0.5,
  animateBy = "words",
  direction = "bottom",
  tag: Tag = "span",
  className,
  onAnimationComplete,
  ...rest
}: BlurTextProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const effectiveMode: "words" | "letters" =
    animateBy === "words" || INDIC_SCRIPT_RE.test(text) ? "words" : "letters";

  useGSAP(
    () => {
      const el = containerRef.current;
      if (!el || !text || shouldSkipBlurMotion()) {
        return;
      }
      const units = el.querySelectorAll<HTMLElement>(".rb-blur-unit");
      if (units.length === 0) {
        return;
      }
      const yOffset = direction === "top" ? -10 : 10;
      const tween = gsap.fromTo(
        units,
        {
          opacity: 0,
          y: yOffset,
          filter: "blur(6px)",
        },
        {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          duration,
          ease: "power2.out",
          stagger: delay / 1000,
          overwrite: "auto",
          onComplete: () => {
            gsap.set(units, { clearProps: "transform,opacity,filter,willChange" });
            onAnimationComplete?.();
          },
        },
      );
      return () => {
        tween.kill();
      };
    },
    {
      dependencies: [text, delay, duration, direction, effectiveMode],
      scope: containerRef,
    },
  );

  const words = text.split(" ");

  return (
    <Tag ref={containerRef as never} className={cx("rb-blur-parent", className)} {...rest}>
      {words.map((word, wordIdx) => (
        <Fragment key={`${word}-${String(wordIdx)}`}>
          {effectiveMode === "words" ? (
            <span className="rb-blur-unit">{word}</span>
          ) : (
            <span className="rb-split-word">
              {Array.from(word).map((char, charIdx) => (
                <span
                  key={`${char}-${String(wordIdx)}-${String(charIdx)}`}
                  className="rb-blur-unit"
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
