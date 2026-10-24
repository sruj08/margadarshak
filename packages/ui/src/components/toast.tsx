"use client";

import { Toast, toast } from "@heroui/react";
import { cx } from "../lib/cx";

/**
 * Toast (DESIGN_SYSTEM §11.2): "Saved", "Copied", "Sent". At least 6 s, pauses on hover/focus,
 * announced politely. Never for an error that needs action (use a Banner).
 */
export const TOAST_TIMEOUT_MS = 6000;

/** Mount once near the root of the app. */
export function ToastRegion({ className }: { className?: string }) {
  return <Toast.Provider placement="bottom" className={cx("md-toast-region", className)} />;
}

export type ToastTone = "default" | "success" | "info";

/** Shows a short confirmation. Returns the toast id. */
export function notify(
  title: string,
  options: { description?: string; tone?: ToastTone; timeout?: number } = {},
): string {
  const { description, tone = "default", timeout = TOAST_TIMEOUT_MS } = options;
  const opts = {
    timeout: Math.max(timeout, TOAST_TIMEOUT_MS),
    ...(description ? { description } : {}),
  };
  if (tone === "success") return toast.success(title, opts);
  if (tone === "info") return toast.info(title, opts);
  return toast(title, opts);
}
