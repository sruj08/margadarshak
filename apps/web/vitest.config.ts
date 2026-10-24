import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const repo = path.join(import.meta.dirname, "..", "..");
const pkg = (...p: string[]) => path.join(repo, "packages", ...p);

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors `paths` in tsconfig.json (Next/Turbopack reads those; Vite does not). The P2 packages
    // are resolved from their TypeScript source, never from dist (FRONTEND §18). Order matters:
    // the first matching entry wins. `@margdarshak/content/node` is deliberately not mapped: it reads
    // the disk and must never reach client code.
    alias: [
      { find: /^@margdarshak\/game-core$/, replacement: pkg("game-core", "src", "index.ts") },
      {
        find: /^@margdarshak\/game-core\/(.+)$/,
        replacement: `${pkg("game-core", "src").replaceAll("\\", "/")}/$1/index.ts`,
      },
      { find: /^@margdarshak\/gamification$/, replacement: pkg("gamification", "src", "index.ts") },
      {
        find: /^@margdarshak\/gamification\/(learning|gamification)$/,
        replacement: `${pkg("gamification", "src").replaceAll("\\", "/")}/$1.ts`,
      },
      { find: /^@margdarshak\/content$/, replacement: pkg("content", "src", "index.ts") },
      { find: "@content", replacement: path.join(repo, "content") },
      { find: "@rulepacks", replacement: path.join(repo, "rulepacks") },
      { find: "@", replacement: path.join(import.meta.dirname, "src") },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
  },
});
