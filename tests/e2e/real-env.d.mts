/** Types for real-env.mjs (the full-stack e2e settings). */
export declare const REAL: {
  apiPort: number;
  webPort: number;
  pgPort: number;
  apiUrl: string;
  webUrl: string;
  hmacSecret: string;
  internalToken: string;
  labToken: string;
  /** E2E_WORK_DIR: database, binaries and log of this run (default services/api/.cache/e2e). */
  workDir: string;
  /** E2E_NEXT_DIST_DIR: the web build directory (default .next-real). */
  nextDistDir: string;
  apiLog: string;
};
