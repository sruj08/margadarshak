import type { ReactNode } from "react";

/**
 * Play shell (UI_SPEC_LEARN_GAMES §1.2, §3.3, §4): full screen for a game in play mode and the LL
 * simulator's exam mode. No TopBar, no tab bar, no voice orb; the game frame owns its own Pause
 * (48 px) and exit. Routes: `learn/practise/<game>/play`, the exam route, and `/nazar` play.
 *
 * Still nested in `[locale]/layout.tsx`, so the providers, the skip link and the non-affiliation
 * footer (D-01, D-19: every page carries it) are rendered after this shell: the stage fills the
 * viewport and the footer sits just below the fold, one scroll away, never inside the play area.
 *
 * Server component with no imports on purpose: nothing here enters any route's first-load JS.
 * Games are loaded by their own page with `next/dynamic(..., { ssr: false })` (FRONTEND §10.1),
 * never from this layout.
 */
export default function PlayLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      tabIndex={-1}
      data-shell="play"
      className="md-main relative flex min-h-dvh w-full flex-col overscroll-none pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      {children}
    </main>
  );
}
