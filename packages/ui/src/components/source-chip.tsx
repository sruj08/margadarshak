"use client";

import { Button as HeroButton, Popover } from "@heroui/react";
import { ArrowUpRight, BookOpenCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * SourceChip (C-10, P6 "honest by construction"). Shows where a rule or number comes from and when it
 * was checked: "CMVR r.32 · checked 23 Oct 2026". Tapping opens a popover with the full source,
 * confidence and a link to the document. Text is passed in already localised.
 */
export interface SourceChipLabels {
  /** Popover heading, e.g. "Where this comes from". */
  heading: string;
  /** Row label for the confidence value, e.g. "Confidence". */
  confidenceLabel?: string;
  /** Link text, e.g. "Open the source". */
  openSource?: string;
  /** Screen-reader suffix for external links, e.g. "(opens in a new tab)". */
  newTab?: string;
}

export interface SourceChipProps {
  /** Short source name on the chip, e.g. "CMVR r.32". */
  source: string;
  /** Localised "checked {date}" text. */
  checked: string;
  /** Long source title for the popover. */
  sourceTitle?: string;
  sourceUrl?: string;
  /** Localised confidence wording ("Checked", "Likely", "Verify at your RTO"). */
  confidence?: string;
  /** Optional rule text or note shown in the popover. */
  detail?: ReactNode;
  labels: SourceChipLabels;
  className?: string;
}

export function SourceChip({
  source,
  checked,
  sourceTitle,
  sourceUrl,
  confidence,
  detail,
  labels,
  className,
}: SourceChipProps) {
  return (
    <Popover>
      <HeroButton
        variant="ghost"
        className={cx("md-source-chip", className)}
        aria-label={`${labels.heading}: ${source}, ${checked}`}
      >
        <span className="md-source-chip__pill">
          <BookOpenCheck aria-hidden="true" className="md-source-chip__icon" strokeWidth={1.75} />
          <span className="md-source-chip__source">{source}</span>
          <span aria-hidden="true" className="md-source-chip__dot">
            ·
          </span>
          <span className="md-source-chip__checked">{checked}</span>
        </span>
      </HeroButton>
      <Popover.Content className="md-popover" placement="top">
        <Popover.Dialog className="md-popover__dialog">
          <Popover.Heading className="md-popover__heading">{labels.heading}</Popover.Heading>
          <p className="md-popover__title">{sourceTitle ?? source}</p>
          <p className="md-popover__meta">{checked}</p>
          {confidence ? (
            <p className="md-popover__meta">
              {labels.confidenceLabel ? `${labels.confidenceLabel}: ` : null}
              {confidence}
            </p>
          ) : null}
          {detail ? <div className="md-popover__detail">{detail}</div> : null}
          {sourceUrl && labels.openSource ? (
            <a
              className="md-popover__link"
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {labels.openSource}
              <ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.75} />
              {labels.newTab ? <span className="md-sr-only"> {labels.newTab}</span> : null}
            </a>
          ) : null}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
