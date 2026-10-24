"use client";

import { SearchField } from "@heroui/react";
import { Chip } from "@margdarshak/ui/components/chip";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { PublicStats } from "@/components/lab/public-stats";
import { Link } from "@/i18n/navigation";
import { GROUPS, type GroupId } from "./services-data";

/**
 * SCR-004 All services, by who you are (MD-120): jump links per group, a client-side search over
 * titles and EN/HI synonyms, and rows that either open a live screen or an honest "coming" page.
 * External destinations show their full domain (scam hygiene).
 */
export function ServicesList() {
  const t = useTranslations("servicesList");
  const [q, setQ] = useState("");
  const groups = Object.keys(GROUPS) as GroupId[];
  const filtered = useMemo(() => {
    const term = q.trim().toLocaleLowerCase();
    return groups.map((g) => ({
      g,
      items: GROUPS[g].filter((it) => {
        if (!term) return true;
        const hay =
          `${t(`item.${it.id}.title` as "item.plan.title")} ${t(`item.${it.id}.line` as "item.plan.line")} ${it.synonyms}`.toLocaleLowerCase();
        return hay.includes(term);
      }),
    }));
  }, [q, t, groups]);
  const count = filtered.reduce((n, f) => n + f.items.length, 0);

  return (
    <div className="mj-screen" data-screen="SCR-004">
      <header className="mj-head">
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{t("sub")}</p>
      </header>
      <SearchField value={q} onChange={setQ} aria-label={t("search")} className="mj-search">
        <SearchField.Group
          className="md-date__group"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <SearchField.SearchIcon />
          <SearchField.Input
            placeholder={t("searchHint")}
            className="mj-input"
            style={{ boxShadow: "none", padding: 0 }}
          />
          <SearchField.ClearButton aria-label={t("clear")} />
        </SearchField.Group>
      </SearchField>
      <nav aria-label={t("jump")}>
        <ul className="mj-jump">
          {groups.map((g) => (
            <li key={g}>
              <a href={`#${g}`}>{t(`group.${g}`)}</a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="md-sr-only" aria-live="polite">
        {t("results", { n: count })}
      </p>
      {count === 0 ? <p className="mj-muted">{t("none", { q })}</p> : null}
      {filtered.map(({ g, items }) =>
        items.length === 0 ? null : (
          <section
            key={g}
            id={g}
            className="mj-screen"
            style={{ gap: 10 }}
            aria-labelledby={`sv-${g}`}
          >
            <h2 id={`sv-${g}`} className="mj-h2">
              {t(`group.${g}`)}
            </h2>
            <ul className="mj-list">
              {items.map((it) => (
                <li key={it.id}>
                  <Link href={it.href} className="mj-list__link" data-testid={`service-${it.id}`}>
                    <span>
                      <span className="mj-list__title">
                        {t(`item.${it.id}.title` as "item.plan.title")}
                      </span>
                      <span className="mj-list__line">
                        {t(`item.${it.id}.line` as "item.plan.line")}
                        {it.external ? ` · ${it.external}` : ""}
                      </span>
                    </span>
                    <span className="mj-list__side">
                      {it.live ? null : (
                        <Chip tone="neutral" glyph={false}>
                          {t("coming")}
                        </Chip>
                      )}
                      {it.external ? (
                        <ArrowUpRight aria-hidden="true" size={18} />
                      ) : (
                        <ChevronRight aria-hidden="true" size={18} />
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
      {q.trim() === "" ? <PublicStats variant="card" /> : null}
    </div>
  );
}
