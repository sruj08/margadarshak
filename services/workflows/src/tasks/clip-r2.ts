// Cloudflare R2 object access for the clip tasks (RW-1), with a small AWS Signature V4 signer on
// node:crypto (no aws4fetch). R2 speaks the S3 API at https://<account>.r2.cloudflarestorage.com
// with region "auto"; path-style URLs: /<bucket>/<key>.
//
// Only what the pipeline needs: PUT an object (body hashed into x-amz-content-sha256) and GET one
// (404 → null). Every request is signed afresh, so a retry is a new signature.
import { createHash, createHmac } from "node:crypto";
import type { R2Config } from "../lib/config.ts";
import type { Bucket, ObjectStore, PutResult } from "./clip-media.ts";

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface SignInput {
  readonly method: string;
  readonly host: string;
  /** Path as sent, already URI-encoded (see encodeKeyPath). */
  readonly path: string;
  /** Extra headers to sign (lower- or mixed-case names); host/x-amz-* are added. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly payloadSha256: string;
  readonly region: string;
  readonly service: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Request time; the signature is valid for 15 minutes around it. */
  readonly date: Date;
}

export interface Signed {
  /** Headers to send (includes Authorization, x-amz-date, x-amz-content-sha256). */
  readonly headers: Record<string, string>;
  readonly canonicalRequest: string;
  readonly stringToSign: string;
  readonly signature: string;
}

const sha256Hex = (s: string | Uint8Array): string => createHash("sha256").update(s).digest("hex");
const hmac = (key: string | Buffer, s: string): Buffer =>
  createHmac("sha256", key).update(s).digest();

/** `20130524T000000Z` */
export function amzDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** S3 URI encoding of an object key: every byte but unreserved characters and `/` is %XX. */
export function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

/** AWS Signature Version 4 (header auth, no query string). */
export function signV4(i: SignInput): Signed {
  const stamp = amzDate(i.date);
  const day = stamp.slice(0, 8);
  const all: Record<string, string> = {
    host: i.host,
    "x-amz-content-sha256": i.payloadSha256,
    "x-amz-date": stamp,
  };
  for (const [k, v] of Object.entries(i.headers ?? {})) all[k.toLowerCase()] = v;
  const names = Object.keys(all).sort();
  const canonicalHeaders = names
    .map((n) => `${n}:${String(all[n]).trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    i.method,
    i.path,
    "",
    canonicalHeaders,
    signedHeaders,
    i.payloadSha256,
  ].join("\n");
  const scope = `${day}/${i.region}/${i.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${i.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, i.region), i.service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  // fetch sets Host itself
  const headers: Record<string, string> = Object.fromEntries(
    Object.entries(all).filter(([k]) => k !== "host"),
  );
  headers["authorization"] =
    `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers, canonicalRequest, stringToSign, signature };
}

export type R2Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class R2Error extends Error {
  override readonly name = "R2Error";
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** ObjectStore on R2. `bucket` "clips" is R2_BUCKET_CLIPS (public), "ingest" is R2_BUCKET_INGEST. */
export class R2ObjectStore implements ObjectStore {
  readonly #cfg: R2Config;
  readonly #fetch: R2Fetch;
  readonly #now: () => Date;
  readonly #timeoutMs: number;

  constructor(cfg: R2Config, opts: { fetch?: R2Fetch; now?: () => Date; timeoutMs?: number } = {}) {
    this.#cfg = cfg;
    this.#fetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.#now = opts.now ?? (() => new Date());
    this.#timeoutMs = opts.timeoutMs ?? 120_000;
  }

  get host(): string {
    return `${this.#cfg.accountId}.r2.cloudflarestorage.com`;
  }

  bucketName(bucket: Bucket): string {
    const name = bucket === "clips" ? this.#cfg.bucketClips : this.#cfg.bucketIngest;
    if (!name)
      throw new R2Error(
        `R2 bucket for "${bucket}" is not configured (R2_BUCKET_${bucket.toUpperCase()})`,
        0,
      );
    return name;
  }

  #request(
    method: "GET" | "PUT",
    bucket: Bucket,
    key: string,
    body?: Uint8Array,
    contentType?: string,
  ) {
    const path = `/${this.bucketName(bucket)}/${encodeKeyPath(key)}`;
    const payloadSha256 = body ? sha256Hex(body) : EMPTY_SHA256;
    const signed = signV4({
      method,
      host: this.host,
      path,
      headers: contentType ? { "content-type": contentType } : {},
      payloadSha256,
      region: "auto",
      service: "s3",
      accessKeyId: this.#cfg.accessKeyId,
      secretAccessKey: this.#cfg.secretAccessKey,
      date: this.#now(),
    });
    const init: RequestInit = {
      method,
      headers: signed.headers,
      signal: AbortSignal.timeout(this.#timeoutMs),
    };
    if (body) init.body = body;
    return { url: `https://${this.host}${path}`, init, payloadSha256 };
  }

  async put(
    bucket: Bucket,
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<PutResult> {
    const r = this.#request("PUT", bucket, key, body, contentType);
    const res = await this.#fetch(r.url, r.init);
    if (!res.ok)
      throw new R2Error(
        `R2 PUT ${bucket}/${key}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
        res.status,
      );
    return { bytes: body.byteLength, sha256: r.payloadSha256 };
  }

  async get(bucket: Bucket, key: string): Promise<Uint8Array | null> {
    const r = this.#request("GET", bucket, key);
    const res = await this.#fetch(r.url, r.init);
    if (res.status === 404) return null;
    if (!res.ok)
      throw new R2Error(
        `R2 GET ${bucket}/${key}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
        res.status,
      );
    return new Uint8Array(await res.arrayBuffer());
  }
}
