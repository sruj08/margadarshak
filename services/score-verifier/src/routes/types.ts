// The route contract shared by app.ts and the self-contained route modules (routes/learn.ts,
// routes/clip.ts). A module exports a RouteMap; app.ts mounts every map behind the same pipeline:
//   POST + signed: content type → body limit → Margdarshak-Signature → replay cache → JSON →
//   Zod request (strict) → handler → Zod response (strict) → 200 application/json.
// Errors are problem+json: handlers throw HttpProblem (or ReplayError for scoring input).
import type { z } from "zod";
import type { VerifierConfig } from "../config.ts";
import type { ContentStore } from "../content-store.ts";
import type { Logger } from "../http-util.ts";

export interface RouteDeps {
  config: VerifierConfig;
  store: ContentStore;
  logger: Logger;
}

export interface RouteContext {
  deps: RouteDeps;
  /** Extra non-sensitive log fields for the request line (e.g. gameId, sid). */
  fields: Record<string, string>;
}

export interface PostRoute<Req extends z.ZodType = z.ZodType, Res extends z.ZodType = z.ZodType> {
  readonly method: "POST";
  /** Strict request schema; unknown fields fail validation. */
  readonly request: Req;
  /** Strict response schema; the handler's output is parsed before it is sent (a miss is a 500). */
  readonly response?: Res;
  /** HTTP status for a request that fails the schema. /verify keeps 422 for compatibility. */
  readonly invalidStatus?: 400 | 422;
  /** Problem title for a schema failure. */
  readonly contract: string;
  /** Returns the response body; it is checked against `response` (readonly library types are fine). */
  handle(input: z.infer<Req>, ctx: RouteContext): Promise<unknown> | unknown;
}

export type RouteMap = Readonly<Record<string, PostRoute>>;

/** Defines a POST route with types inferred from its schemas. */
export function postRoute<Req extends z.ZodType, Res extends z.ZodType>(
  r: Omit<PostRoute<Req, Res>, "method">,
): PostRoute {
  return { method: "POST", ...r } as unknown as PostRoute;
}

/** Epoch milliseconds from Go server time (no route reads the clock). */
export const EPOCH_MS_MAX = 8_640_000_000_000_000;

/** `T` with its `undefined`-valued keys made optional-and-absent (exactOptionalPropertyTypes). */
export type Defined<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & { [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined> };

/** Drops keys whose value is undefined (Zod optionals meet exactOptionalPropertyTypes). */
export function defined<T extends object>(o: T): Defined<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Defined<T>;
}
