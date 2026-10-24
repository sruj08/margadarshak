import type { ShareCardContentWire } from "@/features/games/api-types";

export interface ShareCardLabels {
  brand: string;
  scoreLabel: string;
  /** "counted sessions: {n}" already filled. */
  counted: string;
  rank: string | null;
  badge: string | null;
  tagline: string;
  challenge: string;
  keralaLine: string | null;
  percentile: string | null;
  footer: string;
  /** "Scored on AI-generated road scenes" (ADR-0013); optional so older callers still compile. */
  aiScenes?: string | null;
}

/**
 * The share card's face (UI_SPEC_LEARN_GAMES §7.5, GAMIFICATION_ENGINE §10): name or initials,
 * Nazar Score with counted sessions, rank, at most one badge, "Rewards anticipation, not speed",
 * the optional Kerala line, the AI-generated-scenes label (ADR-0013) and the non-affiliation footer. No PII, no RTO, no dates, no failures.
 * A plain component (no hooks): the public page, the preview and the OG image share the layout.
 */
export function ShareCardView({
  content,
  labels,
}: {
  content: ShareCardContentWire;
  labels: ShareCardLabels;
}) {
  return (
    <figure className="mg-sharecard" data-testid="share-card">
      <p className="mg-sharecard__brand">{labels.brand}</p>
      <p className="mg-sharecard__score" data-testid="share-score">
        {content.nazar_score}
      </p>
      <p className="mg-sharecard__label">{labels.scoreLabel}</p>
      <p className="mg-sharecard__counted">{labels.counted}</p>
      <p className="mg-sharecard__who">
        {content.display_name}
        {labels.rank ? ` · ${labels.rank}` : ""}
      </p>
      {labels.badge ? <p className="mg-sharecard__badge">{labels.badge}</p> : null}
      {labels.percentile ? <p>{labels.percentile}</p> : null}
      <p className="mg-sharecard__tagline">{labels.tagline}</p>
      {labels.keralaLine ? <p className="mg-sharecard__note">{labels.keralaLine}</p> : null}
      <p className="mg-sharecard__note">{labels.challenge}</p>
      {labels.aiScenes ? (
        <p className="mg-sharecard__note" data-testid="share-ai-label">
          {labels.aiScenes}
        </p>
      ) : null}
      <figcaption className="mg-sharecard__footer">{labels.footer}</figcaption>
    </figure>
  );
}
