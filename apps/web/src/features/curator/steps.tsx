"use client";

import { useTranslations } from "next-intl";
import { Adjudicate } from "./Adjudicate";
import { useAdmin } from "./AdminGate";
import { getClip } from "./api";
import { BlurAudit } from "./BlurAudit";
import { ClipScreen } from "./ClipScreen";
import { CueTexts } from "./CueTexts";
import { Publish } from "./Publish";
import { RatingPanel } from "./RaterForm";
import { SyntheticReview } from "./SyntheticReview";

/** `/admin/clips/[clipId]/rate`: the blind rater form, then the ratings once both exist. */
export function RateScreen({ clipId }: { clipId: string }) {
  const { identity } = useAdmin();
  return (
    <ClipScreen clipId={clipId} step="rate">
      {(clip, set) => (
        <RateBody
          clipId={clipId}
          viewer={identity.pseudonym}
          canRate={identity.roles.includes("rater")}
          clip={clip}
          set={set}
        />
      )}
    </ClipScreen>
  );
}

function RateBody({
  clipId,
  viewer,
  canRate,
  clip,
  set,
}: {
  clipId: string;
  viewer: string | null;
  canRate: boolean;
  clip: Parameters<typeof RatingPanel>[0]["clip"];
  set: Parameters<Parameters<typeof ClipScreen>[0]["children"]>[1];
}) {
  return (
    <>
      <RateHeading id={clip.clip_id} />
      <RatingPanel
        clip={clip}
        viewer={viewer}
        canRate={canRate}
        onSaved={(rating, source) => {
          // Show the fresh server view (blind until both ratings exist).
          getClip(clipId)
            .then((r) => set(r.data, r.source))
            .catch(() =>
              set({ ...clip, my_rating: rating, rating_count: clip.rating_count + 1 }, source),
            );
        }}
      />
    </>
  );
}

function RateHeading({ id }: { id: string }) {
  return <StepHeading k="rate.h1" id={id} />;
}

function StepHeading({
  k,
  id,
}: {
  k: "rate.h1" | "audit.h1" | "review.h1" | "adjudicate.h1" | "cues.h1" | "publish.h1";
  id: string;
}) {
  const t = useTranslations("curator");
  return (
    <h1 className="md-h1" data-testid="step-h1">
      {t(k, { id })}
    </h1>
  );
}

export function BlurScreen({ clipId }: { clipId: string }) {
  return (
    <ClipScreen clipId={clipId} step="audit">
      {(clip, set) => (
        <>
          <StepHeading k="audit.h1" id={clip.clip_id} />
          <BlurAudit clip={clip} onSaved={set} />
        </>
      )}
    </ClipScreen>
  );
}

export function AdjudicateScreen({ clipId }: { clipId: string }) {
  const { identity } = useAdmin();
  return (
    <ClipScreen clipId={clipId} step="adjudicate">
      {(clip, set) => (
        <>
          <StepHeading k="adjudicate.h1" id={clip.clip_id} />
          <Adjudicate clip={clip} viewer={identity.pseudonym} onSaved={set} />
        </>
      )}
    </ClipScreen>
  );
}

export function CuesScreen({ clipId }: { clipId: string }) {
  return (
    <ClipScreen clipId={clipId} step="cues">
      {(clip, set) => (
        <>
          <StepHeading k="cues.h1" id={clip.clip_id} />
          <CueTexts clip={clip} onSaved={set} />
        </>
      )}
    </ClipScreen>
  );
}

export function PublishScreen({ clipId }: { clipId: string }) {
  return (
    <ClipScreen clipId={clipId} step="publish">
      {(clip, set) => (
        <>
          <StepHeading k="publish.h1" id={clip.clip_id} />
          <Publish clip={clip} onPublished={set} />
        </>
      )}
    </ClipScreen>
  );
}

/** `/admin/clips/[clipId]/review`: the synthetic review of an AI-generated clip. */
export function ReviewScreen({ clipId }: { clipId: string }) {
  return (
    <ClipScreen clipId={clipId} step="review">
      {(clip, set) => (
        <>
          <StepHeading k="review.h1" id={clip.clip_id} />
          <SyntheticReview clip={clip} onSaved={set} />
        </>
      )}
    </ClipScreen>
  );
}
