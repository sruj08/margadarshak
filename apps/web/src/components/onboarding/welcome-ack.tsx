"use client";

import { Button } from "@margdarshak/ui/components/button";
import { useState } from "react";
import { rememberWelcome } from "@/lib/prefs/device";

/** "Got it": remembers the notice on this device and opens the home screen. */
export function WelcomeAck({ label, locale }: { label: string; locale: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      size="lg"
      className="md-onboard__cta"
      isPending={busy}
      onPress={() => {
        setBusy(true);
        rememberWelcome();
        window.location.assign(`/${locale === "hi" ? "hi" : "en"}`);
      }}
    >
      {label}
    </Button>
  );
}
