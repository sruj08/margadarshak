// Server-side scoring content (hazard windows, LL answer keys, track specs, rule-pack format rows).
// Clients never receive these; the verifier resolves a session's items here and assembles them with
// game-core's assembleContent, so every store behaves identically.
//
// Directory layout (VERIFIER_CONTENT_DIR, written by `pnpm build:content`):
//   <dir>/<kind>/<id>.json        one document per item ref "<kind>:<id>", ":" in <id> written as "_"
//                                 e.g. clip:KL-0001@1 → clip/KL-0001@1.json, q:C-LL1-001:v1 → q/C-LL1-001_v1.json
//   <dir>/formats/<ruleId>.json   rule-pack format rows, e.g. formats/HPT-KL.json, formats/LLT-JK.json
//
// A /verify request may also carry documents inline (`content.items`, e.g. `clip:` documents the Go
// API keeps in its database). CompositeContentStore serves those first and falls back to the
// process-wide store for everything else (`q/`, `formats/`, …).
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fixtureContentDocs, fixtureFormats } from "@margdarshak/game-core/fixtures";
import { type GameContent, ItemRef, type SessionContext } from "@margdarshak/game-core/schema";
import { assembleContent, requiredFormats } from "@margdarshak/game-core/scoring";

/** Raw document lookup; `undefined` means "not found". */
export interface ContentSource {
  /** The raw document for an item ref (`clip:…`, `q:…`, `sd:…`). */
  doc(ref: string): Promise<unknown>;
  /** A raw rule-pack format row by rule ID (`HPT-KL`, `LLT-JK`). */
  format(ruleId: string): Promise<unknown>;
}

export interface ContentStore extends ContentSource {
  readonly kind: "directory" | "fixtures" | "composite";
  /** Resolves and validates the session's content; throws a ReplayError when missing or invalid. */
  load(ctx: SessionContext): Promise<GameContent>;
}

/** File path for an item ref, relative to the store root. */
export function refToPath(ref: string): string {
  const i = ref.indexOf(":");
  if (i <= 0) throw new Error(`bad item ref: ${ref}`);
  const kind = ref.slice(0, i);
  const id = ref.slice(i + 1).replaceAll(":", "_");
  if (
    !/^[a-z]{1,8}$/.test(kind) ||
    !/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(id) ||
    id.includes("..")
  ) {
    throw new Error(`bad item ref: ${ref}`);
  }
  return join(kind, `${id}.json`);
}

const RULE_ID_RE = /^[A-Z]{2,4}-[A-Z0-9]{2,8}$/;

/** Assembles a session's content from any source (shared by every store). */
export async function loadFrom(src: ContentSource, ctx: SessionContext): Promise<GameContent> {
  const items = await Promise.all(ctx.items.map((it) => src.doc(it.ref)));
  const ids = requiredFormats(ctx);
  const rows = await Promise.all(ids.map((id) => src.format(id)));
  const formats = Object.fromEntries(ids.map((id, i) => [id, rows[i]]));
  return assembleContent(ctx, { items, formats });
}

export class DirectoryContentStore implements ContentStore {
  readonly kind = "directory" as const;
  readonly #root: string;
  readonly #cache = new Map<string, unknown>();
  readonly #maxCached: number;

  constructor(root: string, maxCached = 2000) {
    this.#root = resolve(root);
    this.#maxCached = maxCached;
  }

  async #read(rel: string): Promise<unknown> {
    const full = resolve(this.#root, rel);
    if (!full.startsWith(this.#root + sep)) return undefined; // never leave the root
    if (this.#cache.has(full)) return this.#cache.get(full);
    let doc: unknown;
    try {
      doc = JSON.parse(await readFile(full, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
    // Documents are immutable per version (a new version is a new file), so caching is safe.
    if (this.#cache.size >= this.#maxCached) {
      const first = this.#cache.keys().next();
      if (first.done !== true) this.#cache.delete(first.value);
    }
    this.#cache.set(full, doc);
    return doc;
  }

  doc(ref: string): Promise<unknown> {
    let rel: string;
    try {
      rel = refToPath(ref);
    } catch {
      return Promise.resolve(undefined); // an unsafe ref is simply not found
    }
    return this.#read(rel);
  }

  format(ruleId: string): Promise<unknown> {
    if (!RULE_ID_RE.test(ruleId)) return Promise.resolve(undefined);
    return this.#read(join("formats", `${ruleId}.json`));
  }

  load(ctx: SessionContext): Promise<GameContent> {
    return loadFrom(this, ctx);
  }
}

/** The golden-vector content from game-core (dev, tests and the replay CLI). */
export class FixtureContentStore implements ContentStore {
  readonly kind = "fixtures" as const;
  readonly #docs = fixtureContentDocs();
  readonly #formats = fixtureFormats();

  doc(ref: string): Promise<unknown> {
    return Promise.resolve(Object.hasOwn(this.#docs, ref) ? this.#docs[ref] : undefined);
  }

  format(ruleId: string): Promise<unknown> {
    return Promise.resolve(
      Object.hasOwn(this.#formats, ruleId) ? this.#formats[ruleId] : undefined,
    );
  }

  load(ctx: SessionContext): Promise<GameContent> {
    return loadFrom(this, ctx);
  }
}

/** Inline documents of one request, keyed by item ref and by rule ID. */
export interface InlineContent {
  readonly docs: ReadonlyMap<string, unknown>;
  readonly formats: ReadonlyMap<string, unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * How an inline document is keyed:
 *   {ref, doc}                     an explicit envelope (any kind, e.g. `sd:` rounds)
 *   {rule_id, …}                   a rule-pack format row (`HPT-KL`, `LLT-<state>`)
 *   {clipId, version, …}           `clip:<clipId>@<version>` (game-core NazarClip / clip.json)
 *   {trackId, version, …}          `track:<trackId>@<version>`
 *   {qref, …}                      `q:<qref>` (game-core LlAnswerKey)
 * Returns null when the document identifies nothing.
 */
export function inlineKey(
  doc: unknown,
): { kind: "doc"; ref: string; doc: unknown } | { kind: "format"; id: string } | null {
  if (!isObject(doc)) return null;
  const keys = Object.keys(doc);
  if (keys.length === 2 && typeof doc["ref"] === "string" && "doc" in doc) {
    return ItemRef.safeParse(doc["ref"]).success
      ? { kind: "doc", ref: doc["ref"], doc: doc["doc"] }
      : null;
  }
  if (typeof doc["rule_id"] === "string") {
    return RULE_ID_RE.test(doc["rule_id"]) ? { kind: "format", id: doc["rule_id"] } : null;
  }
  const v = doc["version"];
  const ref =
    typeof doc["clipId"] === "string" && Number.isInteger(v)
      ? `clip:${doc["clipId"]}@${String(v)}`
      : typeof doc["trackId"] === "string" && Number.isInteger(v)
        ? `track:${doc["trackId"]}@${String(v)}`
        : typeof doc["qref"] === "string"
          ? `q:${doc["qref"]}`
          : null;
  if (ref === null || !ItemRef.safeParse(ref).success) return null;
  return { kind: "doc", ref, doc };
}

/** Indexes inline documents; the request schema has already rejected unkeyed or duplicate ones. */
export function indexInline(items: readonly unknown[]): InlineContent {
  const docs = new Map<string, unknown>();
  const formats = new Map<string, unknown>();
  for (const item of items) {
    const k = inlineKey(item);
    if (k === null) throw new Error("inline content document without a ref");
    if (k.kind === "doc") docs.set(k.ref, k.doc);
    else formats.set(k.id, item);
  }
  return { docs, formats };
}

/** Inline documents first, then the process-wide store. Built per request. */
export class CompositeContentStore implements ContentStore {
  readonly kind = "composite" as const;
  readonly #inline: InlineContent;
  readonly #base: ContentSource;

  constructor(inline: InlineContent, base: ContentSource) {
    this.#inline = inline;
    this.#base = base;
  }

  doc(ref: string): Promise<unknown> {
    return this.#inline.docs.has(ref)
      ? Promise.resolve(this.#inline.docs.get(ref))
      : this.#base.doc(ref);
  }

  format(ruleId: string): Promise<unknown> {
    return this.#inline.formats.has(ruleId)
      ? Promise.resolve(this.#inline.formats.get(ruleId))
      : this.#base.format(ruleId);
  }

  load(ctx: SessionContext): Promise<GameContent> {
    return loadFrom(this, ctx);
  }
}
