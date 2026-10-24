"use client";

import { useTranslations } from "next-intl";
import type { LlMockRecord } from "@/features/learn/mock-api";
import { LEARN_KEYS, useKv } from "@/features/learn/offline/kv";

const NONE: LlMockRecord[] = [];

/** "Your mocks: 8/10 · 6/10" from this phone's LL simulator history. */
export function LastMocks() {
  const t = useTranslations("llSim.format");
  const mocks = useKv<LlMockRecord[]>(LEARN_KEYS.llsim, NONE);
  if (mocks.length === 0) return null;
  return (
    <span className="ml-small ml-num">
      {t("yourMocks", {
        list: mocks
          .slice(-3)
          .reverse()
          .map((m) => `${m.correct}/${m.total}`)
          .join(" · "),
      })}
    </span>
  );
}
