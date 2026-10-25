import "@/components/journey/journey.css";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Chip } from "@margdarshak/ui/components/chip";
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { COMING, type ComingId } from "@/components/home/services-data";
import { BackLink } from "@/components/journey/status";
import { Link, redirect } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export function generateStaticParams() {
  return COMING.map((serviceId) => ({ serviceId }));
}

/** Where "what you can do today" points for each coming service (always a live route). */
const TODAY: Record<ComingId, string> = {
  "book-test": "/licence",
  "test-day": "/learn",
  "test-vehicle": "/licence",
  retest: "/learn",
  approval: "/licence",
  digilocker: "/licence",
  "ll-expiry": "/licence",
  renew: "/licence",
  "add-class": "/plan",
  address: "/help",
  duplicate: "/help",
  idp: "/help",
  "form-1a": "/plan",
  "first-vehicle": "/learn",
  challan: "/help",
  family: "/plan",
  "minor-riding": "/plan",
  helper: "/help",
  school: "/help",
  console: "/help",
};

/** Services that now have their own screen in the LL-to-DL flow. */
const BUILT: Partial<Record<ComingId, string>> = {
  "book-test": "/dl/apply",
  "test-day": "/dl/test-day",
  "test-vehicle": "/dl/test-day",
  retest: "/dl/retest",
  approval: "/dl/issued",
  digilocker: "/dl/issued",
};

function isComing(v: string): v is ComingId {
  return (COMING as readonly string[]).includes(v);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}): Promise<Metadata> {
  const { serviceId } = await params;
  const t = await getTranslations("comingService");
  return { title: isComing(serviceId) ? t(`${serviceId}.title`) : t("fallback") };
}

/**
 * Honest "coming" state for a service that is not built yet (MD-120: no dead links). Says what the
 * service will do, what works today, and links to a live screen. External services show the domain.
 */
export default async function ComingServicePage({
  params,
}: {
  params: Promise<{ locale: string; serviceId: string }>;
}) {
  const locale = await enterLocale(params);
  const { serviceId } = await params;
  if (!isComing(serviceId)) notFound();
  const built = BUILT[serviceId];
  if (built) redirect({ href: built, locale });
  const t = await getTranslations("comingService");
  const tx = await getTranslations("a11y");
  return (
    <div className="md-page" data-screen={`SVC-${serviceId}`}>
      <div className="mj-screen">
        <BackLink href="/services">{t("back")}</BackLink>
        <header className="mj-head">
          <div className="mj-glow" aria-hidden="true" />
          <Chip tone="neutral" glyph={false} className="mj-persona-chip">
            {t("badge")}
          </Chip>
          <h1 className="mj-title">{t(`${serviceId}.title`)}</h1>
          <p className="mj-sub">{t(`${serviceId}.what`)}</p>
        </header>
        <section className="mj-card" aria-labelledby="svc-today">
          <h2 id="svc-today" className="mj-h2">
            {t("todayTitle")}
          </h2>
          <p>{t(`${serviceId}.today`)}</p>
        </section>
        {serviceId === "challan" ? (
          <a
            href="https://echallan.parivahan.gov.in/"
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClassName({ variant: "secondary", size: "lg", fullWidth: true })}
          >
            echallan.parivahan.gov.in <ArrowUpRight aria-hidden="true" />
            <span className="md-sr-only"> {tx("externalNewTab")}</span>
          </a>
        ) : null}
        <div className="mj-actions">
          <Link
            href={TODAY[serviceId]}
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          >
            {t(`${serviceId}.cta`)}
          </Link>
        </div>
      </div>
    </div>
  );
}
