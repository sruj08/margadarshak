import { getTranslations } from "next-intl/server";
import type { LiteQuizText } from "./lite-quiz";

/** The Lite quiz strings, resolved on the server (no message catalogue is sent to the page). */
export async function liteQuizText(): Promise<LiteQuizText> {
  const t = await getTranslations("learnHub.lite");
  const q = await getTranslations("learnHub.q");
  return {
    submit: t("submit"),
    sure: q("sure"),
    conf50: q("conf50"),
    conf75: q("conf75"),
    conf100: q("conf100"),
    sign: t("sign"),
    score: t("score", { r: "{r}", n: "{n}" }),
    passed: t("passed", { p: "{p}" }),
    notYet: t("notYet", { p: "{p}" }),
    offlineNote: t("offlineNote"),
  };
}
