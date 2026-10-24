import "@/components/journey/journey.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };

/** Lab shell (MD-139): no Margdarshak top bar or tabs, so the replica is unbranded. */
export default function LabLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="md-main mj-lab" style={{ minHeight: "100dvh" }}>
      {children}
    </main>
  );
}
