"use client";

import { Alert } from "@heroui/react";
import { WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { StatusGlyph, type StatusKind } from "./status-glyph";

/**
 * Banner / StatusBanner (C-15). Glyph + title + body + at most one action. Never colour alone, and
 * red only for real danger (P4). `danger` announces assertively (role="alert"); every other tone is
 * a polite status.
 */
export type BannerTone = "info" | "caution" | "success" | "danger" | "offline" | "simulated";

const HERO_STATUS = {
  info: "accent",
  caution: "warning",
  success: "success",
  danger: "danger",
  offline: "default",
  simulated: "default",
} as const;

const GLYPH: Record<Exclude<BannerTone, "offline">, StatusKind> = {
  info: "info",
  caution: "caution",
  success: "done",
  danger: "danger",
  simulated: "simulated",
};

export interface BannerProps {
  tone?: BannerTone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Override the live-region role (e.g. "none" for a static notice that is not news). */
  role?: "status" | "alert" | "note";
}

export function Banner({ tone = "info", title, children, action, className, role }: BannerProps) {
  const liveRole = role ?? (tone === "danger" ? "alert" : "status");
  return (
    <Alert
      status={HERO_STATUS[tone]}
      className={cx("md-banner", `md-banner--${tone}`, className)}
      role={liveRole}
    >
      <Alert.Indicator className="md-banner__glyph">
        {tone === "offline" ? (
          <WifiOff aria-hidden="true" size={22} strokeWidth={1.75} />
        ) : (
          <StatusGlyph kind={GLYPH[tone]} size={22} />
        )}
      </Alert.Indicator>
      <Alert.Content className="md-banner__content">
        <Alert.Title className="md-banner__title">{title}</Alert.Title>
        {children ? (
          <Alert.Description className="md-banner__body">{children}</Alert.Description>
        ) : null}
        {action ? <div className="md-banner__action">{action}</div> : null}
      </Alert.Content>
    </Alert>
  );
}
