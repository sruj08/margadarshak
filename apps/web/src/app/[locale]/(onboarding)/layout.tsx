import type { ReactNode } from "react";
import { TopBar } from "@/components/shell/top-bar";

/** First-run screens (language picker, launch notice): calm, no tab bar, footer still present. */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar minimal />
      <main id="main" tabIndex={-1} className="md-main">
        {children}
      </main>
    </>
  );
}
