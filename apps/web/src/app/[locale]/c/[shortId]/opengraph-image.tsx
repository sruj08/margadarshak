import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { fetchShareCard } from "@/features/share/card-data.server";

/**
 * Share card image (decision D3: API-57's `.png` answers 302 here). 1200 × 630, rendered from the
 * server's public card JSON only. The image text is English for every locale for now: next/og
 * ships a Latin font only, and a Devanagari subset (TTF) is not in the repo yet; the card page
 * itself is fully localised.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Margdarshak Nazar practice score card";

// biome-ignore lint/style/noDefaultExport: Next.js file convention (opengraph-image)
export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; shortId: string }>;
}) {
  const { shortId } = await params;
  const t = await getTranslations({ locale: "en", namespace: "games" });
  const r = await fetchShareCard(shortId);
  const c = r.k === "ok" ? r.card.content : null;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 64,
        background: "linear-gradient(135deg, #2a2c33 0%, #3a3d45 60%, #f9730c 140%)",
        color: "#ffffff",
        fontSize: 32,
      }}
    >
      <div style={{ display: "flex", fontSize: 34, opacity: 0.9 }}>{t("share.brand")}</div>
      {c ? (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 40 }}>
          <div style={{ display: "flex", fontSize: 220, lineHeight: 1, fontWeight: 700 }}>
            {String(c.nazar_score)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 24 }}>
            <div style={{ display: "flex", fontSize: 40 }}>{t("share.scoreLabel")}</div>
            <div style={{ display: "flex" }}>{t("share.counted", { n: c.counted_sessions })}</div>
            <div style={{ display: "flex" }}>{c.display_name}</div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", fontSize: 56 }}>{t("share.antic")}</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 26 }}>
        <div style={{ display: "flex", color: "#ffb053" }}>{t("share.antic")}</div>
        <div style={{ display: "flex", opacity: 0.85 }}>{t("share.footer")}</div>
      </div>
    </div>,
    size,
  );
}
