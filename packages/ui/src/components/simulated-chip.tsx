"use client";

import { Button as HeroButton, Popover } from "@heroui/react";
import { cx } from "../lib/cx";
import { StatusGlyph } from "./status-glyph";

/**
 * SimulatedChip (C-11, MD-045, D-01/D-08). Any value that came from a mock government adapter shows
 * "Simulated" plus what would happen in production ("in production this step runs on Sarathi").
 * It is driven by the API's provenance (`adapter` / `simulated` fields), never by front-end guesswork:
 * pass `adapterMode` from the response; the chip renders nothing for a real adapter.
 */
export type AdapterMode =
  | "mock"
  | "deeplink"
  | "sarathi_redirect"
  | "state_gateway"
  | "nic"
  | "real"
  | (string & {});

/** Modes whose data is synthetic in the hackathon build. Deep links open the real portal. */
const SIMULATED_MODES = new Set<string>(["mock"]);

export function isSimulatedMode(adapterMode: AdapterMode | null | undefined, simulated?: boolean) {
  if (simulated !== undefined) return simulated;
  return adapterMode ? SIMULATED_MODES.has(adapterMode) : false;
}

export interface SimulatedChipProps {
  /** `adapter` value from the API response (e.g. "mock", "deeplink", "nic"). */
  adapterMode: AdapterMode | null | undefined;
  /** Explicit `simulated` flag from the API response; wins over `adapterMode` when present. */
  simulated?: boolean;
  /** Localised chip word: "Simulated" / "सिमुलेशन". */
  label: string;
  /** Localised explanation: "Simulated: in production this step runs on Sarathi." */
  detail: string;
  /** Popover heading; defaults to the label. */
  heading?: string;
  className?: string;
}

export function SimulatedChip({
  adapterMode,
  simulated,
  label,
  detail,
  heading,
  className,
}: SimulatedChipProps) {
  if (!isSimulatedMode(adapterMode, simulated)) return null;
  return (
    <Popover>
      <HeroButton
        variant="ghost"
        className={cx("md-sim-chip", className)}
        aria-label={detail}
        data-adapter-mode={adapterMode ?? "unknown"}
        data-testid="simulated-chip"
      >
        <span className="md-sim-chip__pill">
          <StatusGlyph kind="simulated" size={16} />
          <span>{label}</span>
        </span>
      </HeroButton>
      <Popover.Content className="md-popover" placement="bottom">
        <Popover.Dialog className="md-popover__dialog">
          <Popover.Heading className="md-popover__heading">{heading ?? label}</Popover.Heading>
          <p className="md-popover__body">{detail}</p>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
