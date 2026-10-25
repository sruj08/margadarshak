"use client";

import { Button } from "@margdarshak/ui/components/button";
import { Chip } from "@margdarshak/ui/components/chip";
import { Activity } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "@/i18n/navigation";
import { useActiveCase } from "@/lib/case/case-store";
import { DEMO_TENANT } from "@/lib/journey/api";
import { KEYS, readJson, subscribe } from "@/lib/journey/storage";
import { loadPersona, PersonaSwitcher } from "./persona-switcher";
import { StageHome } from "./stage-home";
import { VoiceButton } from "./voice-sheet";

/**
 * Home body (SCR-003 / SCR-060). The logged-out home is rendered on the server (static, offline
 * precached); when this device holds a case, the stage-aware home replaces it after hydration.
 * The persona switcher is shown only in the demo tenant.
 */
export function HomeBody({ children }: { children: ReactNode }) {
  const active = useActiveCase();
  const router = useRouter();
  const t = useTranslations("personas");
  const [jumping, setJumping] = useState(false);
  const persona = useSyncExternalStore(
    (l) => subscribe(KEYS.persona, l),
    () => readJson<string | null>(KEYS.persona, null),
    () => null,
  );
  const demo = DEMO_TENANT ? (
    <div
      className="mj-demo"
      data-testid="demo-tools"
      style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}
    >
      <PersonaSwitcher />
      <Button
        variant="ghost"
        isPending={jumping}
        data-testid="demo-sarathi-watchdog"
        onPress={async () => {
          setJumping(true);
          try {
            if (!active) {
              await loadPersona("kabir_day12", false);
            }
            router.push("/apply/handoff");
          } finally {
            setJumping(false);
          }
        }}
      >
        <Activity aria-hidden="true" />
        {t("outageDemo")}
      </Button>
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
