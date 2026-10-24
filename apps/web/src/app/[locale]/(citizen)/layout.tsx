import type { ReactNode } from "react";
import { TabBar } from "@/components/shell/tab-bar";
import { TopBar } from "@/components/shell/top-bar";

/** Citizen shell: TopBar, the page, and the four-tab bar (Home · My Licence · Learn · Help). */
export default function CitizenLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <main id="main" tabIndex={-1} className="md-main">
        {children}
      </main>
      <TabBar />
    </>
  );
}
