import "@/components/journey/journey.css";
import "@/features/flow/flow.css";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { OfflineBanner } from "@/components/journey/status";
import { SlotBooking } from "@/features/flow/slot";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("flow.dl");
  return { title: t("slotTitle"), robots: { index: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page">
      <OfflineBanner />
      <Suspense fallback={<Skeleton className="mj-skel-row" />}>
        <SlotBooking />
      </Suspense>
    </div>
  );
}
