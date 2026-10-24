// The video-generation seam for clip_generate (ADR-0013). Task code depends on `VideoGenClient`
// only; `sdkVideoClient` is the one place that loads @google/genai (2.28.0, dynamic import, so
// tests and every other task never load it). Tests use a fake. Never log the key or a prompt.
//
// Facts this relies on (Gemini Omni docs, read 2026-10-24; @google/genai dist/node/node.d.ts):
//   - ai.interactions.create({ model, input, previous_interaction_id?, response_format:
//     { type: "video", aspect_ratio, resolution, delivery } }) → Interaction { id, status,
//     output_video?: { data? (base64), uri?, mime_type? } };
//   - with delivery "uri" the video is a Files API object: poll ai.files.get({ name }) until state
//     ACTIVE (FAILED = error), then ai.files.download({ file, downloadPath });
//   - an extension turn is a new interaction with previous_interaction_id; it adds 3–10 s, up to
//     40 s in total; every output carries an invisible SynthID watermark.
import { NonRetryableError } from "./api.ts";

export interface VideoResponseFormat {
  readonly type: "video";
  readonly aspect_ratio: "16:9" | "9:16";
  readonly resolution: "360p" | "720p";
  readonly delivery: "uri" | "inline";
}

export interface CreateVideoParams {
  readonly model: string;
  /** The full prompt text for this turn (scene + shot + guardrails). */
  readonly input: string;
  readonly previous_interaction_id?: string;
  readonly response_format: VideoResponseFormat;
}

export interface GenVideo {
  readonly data?: string | undefined;
  readonly uri?: string | undefined;
  readonly mime_type?: string | undefined;
}

export interface GenInteraction {
  readonly id: string;
  readonly status: string;
  readonly output_video?: GenVideo | undefined;
  /** Short, already-redacted error text when the interaction failed. */
  readonly error?: string | undefined;
}

export interface GenFile {
  readonly name?: string | undefined;
  /** "PROCESSING" | "ACTIVE" | "FAILED" (also accepted as `{ name }`). */
  readonly state?: string | { readonly name?: string } | undefined;
  readonly uri?: string | undefined;
  readonly error?: { readonly message?: string } | undefined;
}

export interface VideoGenClient {
  createInteraction(params: CreateVideoParams): Promise<GenInteraction>;
  getInteraction(id: string): Promise<GenInteraction>;
  getFile(name: string): Promise<GenFile>;
  downloadFile(file: GenFile, downloadPath: string): Promise<void>;
}

function toInteraction(r: {
  id: string;
  status: string;
  output_video?: { data?: string | undefined; uri?: string | undefined; mime_type?: string | undefined } | undefined;
  errors?: readonly { message?: string | undefined }[] | undefined;
}): GenInteraction {
  const err = r.errors?.map((e) => e.message ?? "").filter(Boolean).join("; ");
  return {
    id: r.id,
    status: r.status,
    output_video: r.output_video
      ? { data: r.output_video.data, uri: r.output_video.uri, mime_type: r.output_video.mime_type }
      : undefined,
    error: err ? err.slice(0, 300) : undefined,
  };
}

/** The real client over @google/genai. The key stays inside the SDK instance. */
export async function sdkVideoClient(apiKey: string): Promise<VideoGenClient> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  return {
    async createInteraction(p) {
      const r = await ai.interactions.create({
        model: p.model,
        input: p.input,
        ...(p.previous_interaction_id ? { previous_interaction_id: p.previous_interaction_id } : {}),
        response_format: {
          type: "video",
          aspect_ratio: p.response_format.aspect_ratio,
          resolution: p.response_format.resolution,
          delivery: p.response_format.delivery,
        },
      });
      return toInteraction(r);
    },
    async getInteraction(id) {
      return toInteraction(await ai.interactions.get(id));
    },
    async getFile(name) {
      const f = await ai.files.get({ name });
      return { name: f.name, state: f.state, uri: f.uri, error: f.error };
    },
    async downloadFile(file, downloadPath) {
      if (!file.name) throw new NonRetryableError("clip.generate", "file has no name", undefined, 0);
      await ai.files.download({ file: file.name, downloadPath });
    },
  };
}

// ---- retry policy for model calls ------------------------------------------------------------

export interface GenRetryPolicy {
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly factor: number;
  readonly maxDelayMs: number;
}

export const GEN_RETRY: GenRetryPolicy = {
  attempts: 5,
  baseDelayMs: 5_000,
  factor: 2,
  maxDelayMs: 60_000,
};

/** HTTP status of an SDK error (`ApiError.status`), when it has one. */
export function errorStatus(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
}

/** 408/425/429/5xx and network failures are worth another try; other 4xx are not. */
export function isRetryableGenError(err: unknown): boolean {
  const status = errorStatus(err);
  if (status !== undefined) return status === 408 || status === 425 || status === 429 || status >= 500;
  const msg = String((err as Error)?.message ?? err);
  return (
    (err as Error)?.name === "TypeError" ||
    /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(msg)
  );
}

/** A short error text that never echoes a request (prompts stay out of logs and run results). */
export function redactedError(err: unknown): string {
  const status = errorStatus(err);
  const msg = String((err as Error)?.message ?? err)
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-key]")
    .replace(/key=[^&\s]+/gi, "key=[redacted]")
    .slice(0, 200);
  return status !== undefined ? `HTTP ${status}: ${msg}` : msg;
}

/**
 * Runs one model call with retries on 429/5xx/network errors (exponential backoff). Anything else
 * becomes a NonRetryableError (a safety block or bad request will not pass on a retry). When the
 * retries run out the error stays retryable, so the Render subtask retry can try again later.
 */
export async function withGenRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: {
    readonly sleep: (ms: number) => Promise<void>;
    readonly policy?: GenRetryPolicy;
    readonly log?: (msg: string, attrs: Record<string, unknown>) => void;
  },
): Promise<T> {
  const p = opts.policy ?? GEN_RETRY;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      if (!isRetryableGenError(err)) {
        throw new NonRetryableError(label, `${label} failed: ${redactedError(err)}`, errorStatus(err), attempt);
      }
      if (attempt >= p.attempts) {
        throw new Error(`${label} failed after ${attempt} attempts: ${redactedError(err)}`);
      }
      const delay = Math.min(p.maxDelayMs, p.baseDelayMs * p.factor ** (attempt - 1));
      opts.log?.("video generation retry", { step: label, attempt, status: errorStatus(err) ?? null, delay_ms: delay });
      await opts.sleep(delay);
    }
  }
}
