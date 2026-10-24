"use client";

import { BookOpen, CircleHelp, House, IdCard } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link, usePathname } from "@/i18n/navigation";

/**
 * TabBar (UI_SPEC_JOURNEY §1.1): four tabs only, icon + label always, 64 px targets. It is navigation,
 * not a tab panel, so it renders as <nav> with links and aria-current="page". Bottom bar on phones,
 * left rail from 1024 px.
 */
const TABS: {
  href: "/" | "/licence" | "/learn" | "/help";
  key: "home" | "licence" | "learn" | "help";
  icon: ReactNode;
}[] = [
  { href: "/", key: "home", icon: <House aria-hidden="true" strokeWidth={1.75} /> },
  { href: "/licence", key: "licence", icon: <IdCard aria-hidden="true" strokeWidth={1.75} /> },
  { href: "/learn", key: "learn", icon: <BookOpen aria-hidden="true" strokeWidth={1.75} /> },
  { href: "/help", key: "help", icon: <CircleHelp aria-hidden="true" strokeWidth={1.75} /> },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname === "";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TabBar() {
  const t = useTranslations("nav");
  const ta = useTranslations("a11y");
  const pathname = usePathname();
  return (
    <nav aria-label={ta("mainNav")} className="md-tabbar">
      <ul className="md-tabbar__list">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <li key={tab.key} className="md-tabbar__item">
              <Link
                href={tab.href}
                className="md-tabbar__link"
                aria-current={active ? "page" : undefined}
                data-active={active ? "true" : undefined}
              >
                <span className="md-tabbar__icon">{tab.icon}</span>
                <span className="md-tabbar__label">{t(tab.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
