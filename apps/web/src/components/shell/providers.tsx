"use client";

import { I18nProvider } from "@heroui/react";
import { MotionRoot } from "@margdarshak/ui/components/motion";
import { ToastRegion } from "@margdarshak/ui/components/toast";
import { SerwistProvider } from "@serwist/turbopack/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { applyPrefs, DEFAULT_PREFS, PREFS_KEY, type Prefs, parsePrefs } from "@/lib/prefs/prefs";
import { UpdatePrompt } from "./update-prompt";

interface PrefsContextValue {
  prefs: Prefs;
  setPrefs: (next: Partial<Prefs>) => void;
}

const PrefsContext = createContext<PrefsContextValue>({ prefs: DEFAULT_PREFS, setPrefs: () => {} });

export function usePrefs(): PrefsContextValue {
  return useContext(PrefsContext);
}

const SW_ENABLED =
  process.env.NODE_ENV === "production" || process.env["NEXT_PUBLIC_SW_IN_DEV"] === "true";

export function Providers({ locale, children }: { locale: string; children: ReactNode }) {
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    try {
      setPrefsState(parsePrefs(localStorage.getItem(PREFS_KEY)));
    } catch {
      // storage disabled: keep defaults
    }
  }, []);

  const setPrefs = useCallback((next: Partial<Prefs>) => {
    setPrefsState((prev) => {
      const merged = { ...prev, ...next };
      const html = document.documentElement;
      // Theme changes ease over 300 ms instead of flashing (Vakyam pattern; tokens.css §8).
      html.classList.add("md-theme-easing");
      applyPrefs(html, merged);
      window.setTimeout(() => html.classList.remove("md-theme-easing"), 350);
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
      } catch {
        // storage disabled: the choice lasts for this page view
      }
      return merged;
    });
  }, []);

  const value = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);

  return (
    <PrefsContext value={value}>
      <I18nProvider locale={locale === "hi" ? "hi-IN" : "en-IN"}>
        <MotionRoot reduced={prefs.reducedMotion}>
          {/* No reload on reconnect: it would wipe in-progress state such as a review summary;
              offline queues sync on their own when the network returns. */}
          <SerwistProvider
            swUrl="/serwist/sw.js"
            disable={!SW_ENABLED}
            reloadOnOnline={false}
            options={{ scope: "/" }}
          >
            {children}
            <UpdatePrompt />
          </SerwistProvider>
          <ToastRegion />
        </MotionRoot>
      </I18nProvider>
    </PrefsContext>
  );
}
