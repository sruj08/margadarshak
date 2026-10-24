// Runtime configuration for the Workflows tasks, read from the environment (infra/render.yaml).
// The service has no DATABASE_URL and no n8n secret: business steps go through the Go API. The one
// exception is clip_generate (ADR-0013), which calls the Gemini video model with GEMINI_API_KEY.
// That key is a non-enumerable property, so JSON.stringify(config) or a log of the config object
// never contains it.

export interface RetryPolicy {
  /** Total attempts per HTTP call, including the first. */
  readonly attempts: number;
  /** Delay before the first retry; doubles (x factor) each time. */
  readonly baseDelayMs: number;
  readonly factor: number;
  readonly maxDelayMs: number;
}

export interface Config {
  /** Base URL of the Go API on Render's private network, e.g. http://margdarshak-api:10000 */
  readonly apiBase: string;
  /** Shared secret for the Margdarshak-Signature header (same value as the API's INTERNAL_HMAC_SECRET). */
  readonly hmacSecret: string;
  /** Optional service bearer token (one of the API's INTERNAL_BEARER_TOKENS). */
  readonly bearerToken: string | undefined;
  /** Maximum clock_batch subtasks in flight (BACKEND.md §7.2: at most 8). */
  readonly sweepConcurrency: number;
  /** Due timeline events per page (keeps a fire_batch body well under the 16 KB step limit). */
  readonly sweepPageSize: number;
  /** Per-call HTTP timeout. */
  readonly httpTimeoutMs: number;
  readonly retry: RetryPolicy;
  // ---- P2 (plan §2.11.6). All optional; a set-but-invalid value is a ConfigError. ----
  /** FIELD_KIT_STATS_SCRIPT: path to the pre-registered nazar_stats.mjs (unset = the repo's field-kit/ copy). */
  readonly fieldKitStatsScript: string | undefined;
  /** FAULT_INJECTION_CLIP_BLUR: `once` fails the first blur attempt of a clip_ingest run (demo retry). */
  readonly faultInjectionClipBlur: FaultInjection;
  /** FFMPEG_PATH: ffmpeg binary for the clip media steps (unset = `ffmpeg` on PATH). */
  readonly ffmpegPath: string | undefined;
  /** BLUR_MODEL_DIR: directory holding the YuNet face and plate ONNX models. */
  readonly blurModelDir: string | undefined;
  /** Cloudflare R2 (clip media). Undefined unless the three credentials are all set. */
  readonly r2: R2Config | undefined;
  /** MEDIA_PUBLIC_BASE_URL: public origin of the clips bucket (CDN), for cdn_warm. No trailing slash. */
  readonly mediaPublicBaseUrl: string | undefined;
  /** GEMINI_API_KEY: clip_generate only. Non-enumerable; never logged or sent to the Go API. */
  readonly geminiApiKey: string | undefined;
  /** GEMINI_MODEL_VIDEO_GEN: the video model (default gemini-omni-1.1-flash). */
  readonly geminiVideoModel: string;
  /** NAZAR_SCENES_PATH: the scene catalogue (unset = the repo's content/nazar/scenes.json). */
  readonly nazarScenesPath: string | undefined;
}

/** GEMINI_MODEL_VIDEO_GEN default (Gemini Omni Flash; the Veo 3.1 previews closed on 2026-10-22). */
export const DEFAULT_GEMINI_MODEL_VIDEO_GEN = "gemini-omni-1.1-flash";
const MODEL_ID = /^[a-z][a-z0-9.-]{2,63}$/;

export type FaultInjection = "off" | "once" | "always";

export interface R2Config {
  /** R2_ACCOUNT_ID: 32 hex chars; the S3 endpoint is https://<id>.r2.cloudflarestorage.com */
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** R2_BUCKET_CLIPS: public, blurred renditions + manifests. */
  readonly bucketClips: string | undefined;
  /** R2_BUCKET_INGEST: private raw uploads and intermediates (lifecycle-deleted). */
  readonly bucketIngest: string | undefined;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

const MAX_CONCURRENCY = 8;

function int(env: Record<string, string | undefined>, key: string, def: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${key} must be an integer in [${min}, ${max}], got ${JSON.stringify(raw)}`);
  }
  return n;
}

function optStr(env: Record<string, string | undefined>, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const v = raw.trim();
  return v === "" ? undefined : v;
}

/** An optional filesystem path: no NUL or newline (it reaches spawn() argv, never a shell). */
function optPath(env: Record<string, string | undefined>, key: string, suffix?: RegExp): string | undefined {
  const v = optStr(env, key);
  if (v === undefined) return undefined;
  if (/[\0\r\n]/.test(v)) throw new ConfigError(`${key} must be a single-line path`);
  if (suffix && !suffix.test(v)) throw new ConfigError(`${key} must match ${suffix}, got ${JSON.stringify(v)}`);
  return v;
}

function faultInjection(env: Record<string, string | undefined>, key: string): FaultInjection {
  const v = (optStr(env, key) ?? "off").toLowerCase();
  if (v === "off" || v === "false" || v === "0") return "off";
  if (v === "once" || v === "always") return v;
  throw new ConfigError(`${key} must be one of off, once, always; got ${JSON.stringify(env[key])}`);
}

const R2_ACCOUNT = /^[0-9a-f]{32}$/i;
const R2_BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function r2Config(env: Record<string, string | undefined>): R2Config | undefined {
  const accountId = optStr(env, "R2_ACCOUNT_ID");
  const accessKeyId = optStr(env, "R2_ACCESS_KEY_ID");
  const secretAccessKey = optStr(env, "R2_SECRET_ACCESS_KEY");
  const bucketClips = optStr(env, "R2_BUCKET_CLIPS");
  const bucketIngest = optStr(env, "R2_BUCKET_INGEST");
  for (const [k, v] of [
    ["R2_BUCKET_CLIPS", bucketClips],
    ["R2_BUCKET_INGEST", bucketIngest],
  ] as const) {
    if (v !== undefined && !R2_BUCKET.test(v)) throw new ConfigError(`${k} is not a valid R2 bucket name: ${JSON.stringify(v)}`);
  }
  const creds = { R2_ACCOUNT_ID: accountId, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey };
  const set = Object.entries(creds).filter(([, v]) => v !== undefined);
  if (set.length === 0) return undefined;
  if (set.length < 3 || !accountId || !accessKeyId || !secretAccessKey) {
    const missing = Object.entries(creds)
      .filter(([, v]) => v === undefined)
      .map(([k]) => k);
    throw new ConfigError(`R2 credentials are partly set; missing: ${missing.join(", ")}`);
  }
  if (!R2_ACCOUNT.test(accountId)) throw new ConfigError("R2_ACCOUNT_ID must be 32 hex characters");
  return { accountId: accountId.toLowerCase(), accessKeyId, secretAccessKey, bucketClips, bucketIngest };
}

function publicBaseUrl(env: Record<string, string | undefined>, key: string): string | undefined {
  const v = optStr(env, key);
  if (v === undefined) return undefined;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new ConfigError(`${key} is not a URL: ${JSON.stringify(v)}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new ConfigError(`${key} must be http(s)`);
  return v.replace(/\/+$/, "");
}

/** Turns API_INTERNAL_HOSTPORT ("host:port", Render's `hostport` property) into a base URL. */
export function apiBaseFrom(hostport: string): string {
  const v = hostport.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(v) ? v : `http://${v}`;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const hostport = env["API_INTERNAL_HOSTPORT"];
  const secret = env["INTERNAL_HMAC_SECRET"];
  const missing = [
    ...(hostport ? [] : ["API_INTERNAL_HOSTPORT"]),
    ...(secret ? [] : ["INTERNAL_HMAC_SECRET"]),
  ];
  if (missing.length > 0 || !hostport || !secret) {
    throw new ConfigError(`missing required env: ${missing.join(", ")}`);
  }
  const token = env["INTERNAL_BEARER_TOKEN"];
  const model = optStr(env, "GEMINI_MODEL_VIDEO_GEN") ?? DEFAULT_GEMINI_MODEL_VIDEO_GEN;
  if (!MODEL_ID.test(model)) throw new ConfigError(`GEMINI_MODEL_VIDEO_GEN is not a model id: ${JSON.stringify(model)}`);
  const geminiKey = optStr(env, "GEMINI_API_KEY");
  if (geminiKey !== undefined && /s/.test(geminiKey)) throw new ConfigError("GEMINI_API_KEY must not contain whitespace");
  const config: Omit<Config, "geminiApiKey"> = {
    apiBase: apiBaseFrom(hostport),
    hmacSecret: secret,
    bearerToken: token ? token : undefined,
    sweepConcurrency: int(env, "CLOCK_SWEEP_CONCURRENCY", MAX_CONCURRENCY, 1, MAX_CONCURRENCY),
    sweepPageSize: int(env, "CLOCK_SWEEP_PAGE_SIZE", 200, 1, 250),
    httpTimeoutMs: int(env, "API_STEP_TIMEOUT_MS", 30_000, 1_000, 280_000),
    retry: {
      attempts: int(env, "API_STEP_ATTEMPTS", 4, 1, 10),
      baseDelayMs: int(env, "API_STEP_RETRY_BASE_MS", 1_000, 0, 60_000),
      factor: 2,
      maxDelayMs: 30_000,
    },
    fieldKitStatsScript: optPath(env, "FIELD_KIT_STATS_SCRIPT", /\.(mjs|js)$/),
    faultInjectionClipBlur: faultInjection(env, "FAULT_INJECTION_CLIP_BLUR"),
    ffmpegPath: optPath(env, "FFMPEG_PATH"),
    blurModelDir: optPath(env, "BLUR_MODEL_DIR"),
    r2: r2Config(env),
    mediaPublicBaseUrl: publicBaseUrl(env, "MEDIA_PUBLIC_BASE_URL"),
    geminiVideoModel: model,
    nazarScenesPath: optPath(env, "NAZAR_SCENES_PATH", /.json$/),
  };
  Object.defineProperty(config, "geminiApiKey", { value: geminiKey, enumerable: false });
  return config as Config;
}
