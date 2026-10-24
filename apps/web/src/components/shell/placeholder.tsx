import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Chip } from "@margdarshak/ui/components/chip";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

/**
 * Placeholder state for routes whose body ships in P1 (MD-021: every route renders, no dead buttons).
 * One heading, one line, one working link.
 */
export async function PlaceholderPage({
  title,
  emptyTitle,
  emptyLine,
  action,
  screenId,
  children,
}: {
  title: string;
  emptyTitle: string;
  emptyLine: string;
  action?: { href: string; label: string };
  screenId: string;
  children?: ReactNode;
}) {
  const t = await getTranslations("placeholder");
  const act = action ?? { href: "/", label: t("back") };
  return (
    <div className="md-page" data-screen={screenId}>
      <div className="md-stack">
        <h1 className="md-h1">{title}</h1>
        <Chip tone="primary" glyph={false} className="md-badge-next">
          {t("badge")}
        </Chip>
      </div>
      <EmptyState
        title={emptyTitle}
        line={emptyLine}
        action={
          <Link href={act.href} className={buttonClassName({ variant: "primary", size: "lg" })}>
            {act.label}
          </Link>
        }
      />
      {children}
    </div>
  );
}
