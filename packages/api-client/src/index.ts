/**
 * @margdarshak/api-client: the one typed client for api/openapi.yaml (FRONTEND §5).
 * - Types are generated (`pnpm gen:api`) into src/generated/schema.ts; never edit them by hand.
 * - Wire format is snake_case; `toCamel()` (./case) maps a response for UI code when wanted.
 * - Every request carries X-Tenant, Accept-Language and X-Request-Id; writes carry an Idempotency-Key
 *   and `X-Requested-With: margdarshak` (the CSRF defence the API requires for cookie sessions).
 * - Errors are RFC 9457 problem+json (`ApiProblem`).
 */
import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./generated/schema";

export type { components, operations, paths } from "./generated/schema";
export type Schemas = components["schemas"];
export type ApiProblem = Schemas["Problem"];
export type Provenance = Schemas["Provenance"];

export interface ApiClientOptions {
  /** e.g. NEXT_PUBLIC_API_BASE_URL (browser) or API_INTERNAL_URL (server). */
  baseUrl: string;
  /** State tenant code, e.g. "JK". */
  tenant?: string;
  /** UI locale: "en" | "hi". */
  locale?: string;
  fetch?: (input: Request) => Promise<Response>;
  /** Override the id generator (tests). */
  newId?: () => string;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function defaultId(): string {
  return globalThis.crypto.randomUUID();
}

export function contextMiddleware(opts: Omit<ApiClientOptions, "baseUrl" | "fetch">): Middleware {
  const newId = opts.newId ?? defaultId;
  return {
    onRequest({ request }) {
      const h = request.headers;
      if (opts.tenant && !h.has("X-Tenant")) h.set("X-Tenant", opts.tenant);
      if (opts.locale && !h.has("Accept-Language")) h.set("Accept-Language", opts.locale);
      if (!h.has("X-Request-Id")) h.set("X-Request-Id", newId());
      if (WRITE_METHODS.has(request.method)) {
        if (!h.has("Idempotency-Key")) h.set("Idempotency-Key", newId());
        if (!h.has("X-Requested-With")) h.set("X-Requested-With", "margdarshak");
      }
      return request;
    },
  };
}

export function createApiClient(opts: ApiClientOptions) {
  const client = createClient<paths>({
    baseUrl: opts.baseUrl.replace(/\/+$/, ""),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  client.use(
    contextMiddleware({
      ...(opts.tenant ? { tenant: opts.tenant } : {}),
      ...(opts.locale ? { locale: opts.locale } : {}),
      ...(opts.newId ? { newId: opts.newId } : {}),
    }),
  );
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Narrow an unknown error body to RFC 9457 problem details. */
export function isProblem(value: unknown): value is ApiProblem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["title"] === "string" && typeof v["status"] === "number";
}

/**
 * Adapter provenance carried by adapter-backed responses (`adapter`, `simulated`). The UI's
 * SimulatedChip is driven by this, never by front-end guesswork (MD-045).
 */
export interface AdapterProvenance {
  adapterMode: string | null;
  simulated: boolean;
}

export function adapterProvenance(body: unknown): AdapterProvenance {
  if (typeof body !== "object" || body === null) return { adapterMode: null, simulated: false };
  const v = body as Record<string, unknown>;
  const adapterMode = typeof v["adapter"] === "string" ? v["adapter"] : null;
  const simulated = typeof v["simulated"] === "boolean" ? v["simulated"] : adapterMode === "mock";
  return { adapterMode, simulated };
}
