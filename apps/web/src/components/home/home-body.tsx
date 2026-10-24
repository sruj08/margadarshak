"use client";

import { Chip } from "@margdarshak/ui/components/chip";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { useActiveCase } from "@/lib/case/case-store";
import { DEMO_TENANT } from "@/lib/journey/api";
import { KEYS, readJson, subscribe } from "@/lib/journey/storage";
import { PersonaSwitcher } from "./persona-switcher";
import { StageHome } from "./stage-home";
import { VoiceButton } from "./voice-sheet";

/**
 * Home body (SCR-003 / SCR-060). The logged-out home is rendered on the server (static, offline
 * precached); when this device holds a case, the stage-aware home replaces it after hydration.
 * The persona switcher is shown only in the demo tenant.
 */
export function HomeBody({ children }: { children: ReactNode }) {
  const active = useActiveCase();
  const t = useTranslations("personas");
  const persona = useSyncExternalStore(
    (l) => subscribe(KEYS.persona, l),
    () => readJson<string | null>(KEYS.persona, null),
    () => null,
  );
  const demo = DEMO_TENANT ? (
    <div className="mj-demo" data-testid="demo-tools">
      <PersonaSwitcher />
    </div>
  ) : null;
  if (active) {
    return (
      <StageHome
        active={active}
        extra={
          <>
            <VoiceButton />
            {demo}
          </>
        }
      />
    );
  }
  return (
    <>
      {children}
      {persona === null ? null : (
        <Chip tone="simulated">{t("chip", { name: t(`p.${persona as "kabir_new"}.name`) })}</Chip>
      )}
      {demo}
    </>
  );
}
