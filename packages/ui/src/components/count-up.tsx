"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { type HTMLAttributes, useRef } from "react";
import { cx } from "../lib/cx";

gsap.registerPlugin(useGSAP);

export interface CountUpProps extends HTMLAttributes<HTMLSpanElement> {
  to: number;
  from?: number;
  direction?: "up" | "down";
  delay?: number;
  duration?: number;
  separator?: string;
  startWhen?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
}

function shouldSkipCountUpMotion(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) {
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

function getDecimalPlaces(num: number): number {
  const str = num.toString();
  if (str.includes(".")) {
    const decimals = str.split(".")[1] ?? "";
    if (Number.parseInt(decimals, 10) !== 0) {
      return decimals.length;
    }
  }
  return 0;
}

function formatCountValue(val: number, maxDecimals: number, separator: string): string {
  const options: Intl.NumberFormatOptions = {
    useGrouping: Boolean(separator),
    minimumFractionDigits: maxDecimals > 0 ? maxDecimals : 0,
    maximumFractionDigits: maxDecimals > 0 ? maxDecimals : 0,
  };
  const formatted = Intl.NumberFormat("en-US", options).format(val);
  return separator ? formatted.replace(/,/g, separator) : formatted;
}

/**
 * React Bits `CountUp` (`@react-bits/CountUp-TS-CSS`) powered by GSAP.
 * Renders tabular numbers with smooth count interpolation while keeping SSR
 * and unit-test initial `textContent` accurate.
 */
export function CountUp({
  to,
  from = 0,
  direction = "up",
  delay = 0,
  duration = 0.65,
  className,
  startWhen = true,
  separator = "",
  onStart,
  onEnd,
  ...rest
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const maxDecimals = Math.max(getDecimalPlaces(from), getDecimalPlaces(to));
  const targetValue = direction === "down" ? from : to;
  const initialValue = direction === "down" ? to : from;
  const formattedTarget = formatCountValue(targetValue, maxDecimals, separator);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || !startWhen || shouldSkipCountUpMotion()) {
        return;
      }
      const proxy = { value: initialValue };
      onStart?.();

      const tween = gsap.to(proxy, {
        value: targetValue,
        duration,
        delay,
        ease: "power2.out",
        onUpdate: () => {
          if (ref.current) {
            ref.current.textContent = formatCountValue(
              maxDecimals > 0 ? proxy.value : Math.round(proxy.value),
              maxDecimals,
              separator,
            );
          }
        },
        onComplete: () => {
          if (ref.current) {
            ref.current.textContent = formattedTarget;
          }
          onEnd?.();
        },
      });

      return () => {
        tween.kill();
        if (ref.current) {
          ref.current.textContent = formattedTarget;
        }
      };
    },
    {
      dependencies: [
        initialValue,
        targetValue,
        duration,
        delay,
        startWhen,
        maxDecimals,
        separator,
        formattedTarget,
      ],
      scope: ref,
    },
  );

  return (
    <span ref={ref} className={cx("rb-count-up", className)} {...rest}>
      {formattedTarget}
    </span>
  );
}
