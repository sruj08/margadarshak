import type { ReactNode } from "react";
import "./globals.css";

/**
 * Pass-through root layout (next-intl pattern): `app/[locale]/layout.tsx` renders <html> with the
 * right `lang`. This file exists so the root `not-found.tsx` and route handlers have a parent.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
