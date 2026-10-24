import { buttonVariants } from "@heroui/styles";
import { cx } from "../lib/cx";

/**
 * Server-safe class names for the Button look (no "use client"): use them to make a link (`<a>` /
 * next-intl `Link`) look like a Button, so navigation stays a real link.
 */
export type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "outline" | "danger";
export type ButtonSize = "md" | "lg";

export function buttonClassName({
  variant = "secondary",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return cx(
    buttonVariants({ variant, size: size === "lg" ? "lg" : "md", fullWidth }),
    "md-button",
    `md-button--${variant}`,
    `md-button--${size}`,
    className,
  );
}
