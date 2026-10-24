"use client";

import { Card as HeroCard } from "@heroui/react";
import type { ComponentProps, MouseEvent, MouseEventHandler } from "react";
import { cx } from "../lib/cx";
import { applySpotlightPosition } from "./spotlight-card";

/**
 * Card (DESIGN_SYSTEM §5.5, §11.2): hairline first (e0), radius 16, `e1` on hover/press only when
 * the card is interactive. Compound API as HeroUI v3: Card.Header / Title / Description / Content / Footer.
 */
type HeroCardProps = ComponentProps<typeof HeroCard>;

export interface CardProps extends Omit<HeroCardProps, "className" | "variant" | "onMouseMove"> {
  tone?: "default" | "well" | "transparent";
  /** Adds hover/press elevation. Use when the whole card is one link (VerbTile, StageCard). */
  interactive?: boolean;
  className?: string;
  onMouseMove?: MouseEventHandler<HTMLDivElement>;
}

function CardRoot({
  tone = "default",
  interactive = false,
  className,
  onMouseMove,
  ...rest
}: CardProps) {
  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (interactive) {
      applySpotlightPosition(event.currentTarget, event.clientX, event.clientY);
    }
    onMouseMove?.(event);
  };

  return (
    <HeroCard
      variant={tone === "well" ? "secondary" : tone === "transparent" ? "transparent" : "default"}
      onMouseMove={handleMouseMove as never}
      className={cx(
        "md-card",
        `md-card--${tone}`,
        interactive && "md-card--interactive rb-card-spotlight",
        className,
      )}
      {...rest}
    />
  );
}

export const Card = Object.assign(CardRoot, {
  Header: HeroCard.Header,
  Title: HeroCard.Title,
  Description: HeroCard.Description,
  Content: HeroCard.Content,
  Footer: HeroCard.Footer,
});
