// HMAC client for the Go API's business steps: POST /internal/job-steps/{step}.
//
// Contract (BACKEND.md §8.1; the Go handler lives in services/api/internal/jobs):
//   request body  {"run_id": "<Render task run id or null>", "args": {...IDs only...}}  (<= 16 KB)
//   headers       Content-Type: application/json
//                 Margdarshak-Signature: t=<unix>,v1=<hex hmac-sha256(secret, t + "." + body)>
//                 Idempotency-Key: <caller key>      (the API dedupes by (run_id, step, input digest) too)
//                 Authorization: Bearer <token>      (only when INTERNAL_BEARER_TOKEN is set)
//   response      200 {...step result...}  |  RFC 9457 problem+json on error
//
// Retries: network errors, timeouts, 408, 425, 429 and 5xx are retried with exponential backoff.
// Each attempt is re-signed with a strictly newer timestamp, because the API's replay cache
// rejects a signature it has already seen. Other 4xx responses fail at once (NonRetryableError).
import type { Config, RetryPolicy } from "./config.ts";
import { SIGNATURE_HEADER, sign } from "./hmac.ts";

export const MAX_STEP_BODY_BYTES = 16 * 1024;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiDeps {
  readonly fetch?: FetchLike;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Milliseconds since the epoch (Date.now by default). */
  readonly now?: () => number;
  readonly log?: (msg: string, attrs: Record<string, unknown>) => void;
}

export interface StepOptions {
  readonly runId?: string | undefined;
  readonly idempotencyKey: string;
}

export class StepError extends Error {
  override readonly name: string = "StepError";
  readonly step: string;
  readonly status: number | undefined;
  readonly attempts: number;
  constructor(step: string, message: string, status: number | undefined, attempts: number) {
    super(message);
    this.step = step;
    this.status = status;
    this.attempts = attempts;
  }
}

/** A failure retrying cannot fix (bad input, auth, unknown step). */
export class NonRetryableError extends StepError {
  override readonly name: string = "NonRetryableError";
}

const STEP_NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function backoffDelay(policy: RetryPolicy, retryIndex: number): number {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * policy.factor ** retryIndex);
}

export interface ApiClient {
  step<T = unknown>(step: string, args: Record<string, unknown>, opts: StepOptions): Promise<T>;
  get<T = unknown>(path: string): Promise<{ status: number; body: T | undefined }>;
}

export function createApiClient(config: Config, deps: ApiDeps = {}): ApiClient {
  const doFetch: FetchLike = deps.fetch ?? ((u, i) => fetch(u, i));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});

  async function step<T>(name: string, args: Record<string, unknown>, opts: StepOptions): Promise<T> {
    if (!STEP_NAME.test(name)) throw new NonRetryableError(name, `invalid step name ${JSON.stringify(name)}`, undefined, 0);
    const body = JSON.stringify({ run_id: opts.runId ?? null, args });
    if (Buffer.byteLength(body, "utf8") > MAX_STEP_BODY_BYTES) {
      throw new NonRetryableError(name, `step body exceeds ${MAX_STEP_BODY_BYTES} bytes`, undefined, 0);
    }
    const url = `${config.apiBase}/internal/job-steps/${name}`;
    const { attempts } = config.retry;
    let lastTs = 0;
    let lastErr: StepError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Strictly increasing timestamp per attempt: a re-sent body gets a fresh signature.
      const ts = Math.max(Math.floor(now() / 1000), lastTs + 1);
      lastTs = ts;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        [SIGNATURE_HEADER]: sign(config.hmacSecret, ts, body),
        "Idempotency-Key": opts.idempotencyKey,
      };
      if (config.bearerToken) headers["Authorization"] = `Bearer ${config.bearerToken}`;
      let status: number | undefined;
      try {
        const res = await doFetch(url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(config.httpTimeoutMs),
        });
        status = res.status;
        const text = await res.text();
        if (res.ok) return (text ? JSON.parse(text) : {}) as T;
        const detail = text.slice(0, 300);
        if (!isRetryableStatus(res.status)) {
          throw new NonRetryableError(name, `step ${name} failed: HTTP ${res.status} ${detail}`, res.status, attempt);
        }
        lastErr = new StepError(name, `step ${name} failed: HTTP ${res.status} ${detail}`, res.status, attempt);
      } catch (err) {
        if (err instanceof NonRetryableError) throw err;
        if (err instanceof StepError) lastErr = err;
        else lastErr = new StepError(name, `step ${name} failed: ${(err as Error)?.message ?? String(err)}`, status, attempt);
      }
      if (attempt < attempts) {
        const delay = backoffDelay(config.retry, attempt - 1);
        log("job step retry", { step: name, attempt, status: lastErr.status, delay_ms: delay });
        await sleep(delay);
      }
    }
    throw lastErr ?? new StepError(name, `step ${name} failed`, undefined, attempts);
  }

  async function get<T>(path: string): Promise<{ status: number; body: T | undefined }> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (config.bearerToken) headers["Authorization"] = `Bearer ${config.bearerToken}`;
    const res = await doFetch(`${config.apiBase}${path}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(Math.min(config.httpTimeoutMs, 5_000)),
    });
    const text = await res.text();
    let body: T | undefined;
    try {
      body = text ? (JSON.parse(text) as T) : undefined;
    } catch {
      body = undefined;
    }
    return { status: res.status, body };
  }

  return { step, get };
}
