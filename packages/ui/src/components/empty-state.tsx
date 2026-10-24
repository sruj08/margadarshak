import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { DawnRoad } from "./dawn-road";

/**
 * EmptyState (C-42, CONTENT_STYLE §5.21): an illustration, one line, one action. The illustration
 * is decorative; the line says what to do next.
 */
export interface EmptyStateProps {
  title: ReactNode;
  line?: ReactNode;
  action?: ReactNode;
  illustration?: ReactNode;
  /** Heading level for the title; pages that already have an h1 use the default h2. */
  as?: "h1" | "h2" | "h3";
  className?: string;
}

export function EmptyState({
  title,
  line,
  action,
  illustration,
  as: Heading = "h2",
  className,
}: EmptyStateProps) {
  return (
    <section className={cx("md-empty", className)}>
      <div className="md-empty__art">{illustration ?? <DawnRoad className="md-empty__svg" />}</div>
      <Heading className="md-empty__title">{title}</Heading>
      {line ? <p className="md-empty__line">{line}</p> : null}
      {action ? <div className="md-empty__action">{action}</div> : null}
    </section>
  );
}
