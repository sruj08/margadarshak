"use client";

import { useSyncExternalStore } from "react";

/** navigator.onLine as a hook (SSR assumes online, so server HTML never shows an offline note). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener("online", l);
      window.addEventListener("offline", l);
      return () => {
        window.removeEventListener("online", l);
        window.removeEventListener("offline", l);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
