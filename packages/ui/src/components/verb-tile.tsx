import type { ComponentType, ReactNode } from "react";
import { cx } from "../lib/cx";
import { SpotlightOverlay } from "./spotlight-card";

/**
 * VerbTile (C-02, F-01): pictogram, a verb label of at most four words and a one-line hint. The whole
 * tile is one link (one target, accessible name = title + line). Pass the router's Link component
 * (next-intl `Link`) as `linkAs` so navigation stays client-side.
 */
export interface VerbTileProps {
  href: string;
  icon: ReactNode;
  title: ReactNode;
  line?: ReactNode;
  highlight?: boolean;
  linkAs?: ComponentType<{ href: string; className?: string; children: ReactNode }>;
  className?: string;
}

export function VerbTile({
  href,
  icon,
  title,
  line,
  highlight = false,
  linkAs: LinkComponent,
  className,
}: VerbTileProps) {
  const cls = cx(
    "md-verb-tile",
    "rb-card-spotlight",
    highlight && "md-verb-tile--highlight",
    className,
  );
  const body = (
    <>
      <SpotlightOverlay />
      <span className="md-verb-tile__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="md-verb-tile__title">{title}</span>
      {line ? <span className="md-verb-tile__line">{line}</span> : null}
    </>
  );
  if (LinkComponent) {
    return (
      <LinkComponent href={href} className={cls}>
        {body}
      </LinkComponent>
    );
  }
  return (
    <a href={href} className={cls}>
      {body}
    </a>
  );
}
