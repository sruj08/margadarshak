"use client";

import { Button as HeroButton } from "@heroui/react";
import type { ComponentProps } from "react";
import { cx } from "../lib/cx";
import type { ButtonSize, ButtonVariant } from "./button-class";

/**
 * Button (DESIGN_SYSTEM §11.2). One `primary` per screen. Sizes follow the 48 px target floor:
 * `md` = 48 px (everything else), `lg` = 56 px (the screen's primary action, full width on mobile).
 * Built on HeroUI v3 Button (React Aria): use `onPress`, not `onClick`. For links that look like
 * buttons, use `buttonClassName` from ./button-class (server-safe).
 */
type HeroButtonProps = ComponentProps<typeof HeroButton>;

export interface ButtonProps extends Omit<HeroButtonProps, "size" | "variant" | "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

export function Button({ variant = "secondary", size = "md", className, ...rest }: ButtonProps) {
  return (
    <HeroButton
      variant={variant}
      size={size === "lg" ? "lg" : "md"}
      className={cx("md-button", `md-button--${variant}`, `md-button--${size}`, className)}
      {...rest}
    />
  );
}
