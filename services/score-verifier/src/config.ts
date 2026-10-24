// Verifier configuration from the environment. The secret is required: the service refuses to start
// without one. Names follow infra (VERIFIER_SHARED_SECRET, PORT) with the older .env.example names
// as fallbacks (SCORE_VERIFIER_HMAC_SECRET, SCORE_VERIFIER_PORT).

export interface VerifierConfig {
  secret: string;
  port: number;
  host: string;
  /** Directory-backed content store; null = built-in golden fixtures (dev and tests only). */
  contentDir: string | null;
  bodyLimitBytes: number;
  requestTimeoutMs: number;
  /** Accepted clock skew for signatures (±s). */
  signatureWindowS: number;
  /** Accepted signatures remembered to reject replays. */
  replayCacheSize: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const DEFAULT_PORT = 8081;
export const DEFAULT_BODY_LIMIT = 256 * 1024;

type Env = Readonly<Record<string, string | undefined>>;

const nonEmpty = (v: string | undefined): string | undefined =>
  v !== undefined && v.trim() !== "" ? v : undefined;

function intFrom(
  env: Env,
  names: readonly string[],
  fallback: number,
  min: number,
  max: number,
): number {
  for (const n of names) {
    const raw = nonEmpty(env[n]);
    if (raw === undefined) continue;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < min || v > max)
      throw new ConfigError(`${n} must be an integer in [${min}, ${max}]`);
    return v;
  }
  return fallback;
}

export function loadConfig(env: Env): VerifierConfig {
  const secret =
    nonEmpty(env["VERIFIER_SHARED_SECRET"]) ?? nonEmpty(env["SCORE_VERIFIER_HMAC_SECRET"]);
  if (secret === undefined) {
    throw new ConfigError("VERIFIER_SHARED_SECRET (or SCORE_VERIFIER_HMAC_SECRET) is required");
  }
  return {
    secret,
    port: intFrom(env, ["PORT", "SCORE_VERIFIER_PORT"], DEFAULT_PORT, 0, 65535),
    host: nonEmpty(env["HOST"]) ?? "0.0.0.0",
    contentDir: nonEmpty(env["VERIFIER_CONTENT_DIR"]) ?? null,
    bodyLimitBytes: intFrom(
      env,
      ["VERIFIER_BODY_LIMIT_BYTES"],
      DEFAULT_BODY_LIMIT,
      1024,
      4 * 1024 * 1024,
    ),
    requestTimeoutMs: intFrom(env, ["VERIFIER_REQUEST_TIMEOUT_MS"], 10_000, 100, 120_000),
    signatureWindowS: 300,
    replayCacheSize: intFrom(env, ["VERIFIER_REPLAY_CACHE_SIZE"], 10_000, 10, 1_000_000),
  };
}
