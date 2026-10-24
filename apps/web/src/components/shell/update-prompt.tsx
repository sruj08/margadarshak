"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { useSerwist } from "@serwist/turbopack/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/**
 * "Update ready" prompt (MD-021, FRONTEND §8.1). A new service worker waits; the app never reloads
 * itself mid-application or mid-game. The user chooses when.
 */
export function UpdatePrompt() {
  const t = useTranslations("update");
  const { serwist } = useSerwist();
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!serwist) return;
    const onWaiting = () => setWaiting(true);
    const onControlling = () => window.location.reload();
    serwist.addEventListener("waiting", onWaiting);
    serwist.addEventListener("controlling", onControlling);
    return () => {
      serwist.removeEventListener("waiting", onWaiting);
      serwist.removeEventListener("controlling", onControlling);
    };
  }, [serwist]);

  if (!waiting || !serwist) return null;
  return (
    <div className="md-update">
      <Banner
        tone="info"
        title={t("ready")}
        action={
          <Button variant="primary" onPress={() => serwist.messageSkipWaiting()}>
            {t("reload")}
          </Button>
        }
      />
    </div>
  );
}
