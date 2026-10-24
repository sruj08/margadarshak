"use client";

import { Button } from "@margdarshak/ui/components/button";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { useTranslations } from "next-intl";

/**
 * Pause sheet (UI_SPEC_LEARN_GAMES §4.4). Opens on the Pause button, P/Esc, or the page being hidden
 * (mandatory). Resume is the primary action; Quit never scores the run. Closing the sheet resumes.
 */
export function PauseSheet({
  isOpen,
  note,
  onResume,
  onQuit,
}: {
  isOpen: boolean;
  note: "user" | "hidden" | "voided";
  onResume: () => void;
  onQuit: () => void;
}) {
  const t = useTranslations("games");
  const line = note === "voided" ? t("pause.voided") : note === "hidden" ? t("pause.hidden") : null;
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onResume();
      }}
      title={t("pause.title")}
      closeLabel={t("pause.resume")}
      {...(line ? { description: line } : {})}
    >
      <div className="mg-sheet-actions" data-testid="pause-sheet">
        <Button variant="primary" size="lg" onPress={onResume} data-testid="pause-resume">
          {t("pause.resume")}
        </Button>
        <Button variant="ghost" onPress={onQuit} data-testid="pause-quit">
          {t("pause.quit")}
        </Button>
      </div>
    </Sheet>
  );
}
