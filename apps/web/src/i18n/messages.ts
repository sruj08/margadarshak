import type { AppLocale } from "./routing";

/**
 * P2 message namespaces (plan §3). Each one lives in its own pair of files,
 * `messages/{en,hi}/<namespace>.json`, owned by one workstream, so P2 never edits the shared
 * `messages/{en,hi}.json`. A namespace file holds the namespace body (no wrapper key):
 * `messages/en/nazar.json` = `{ "title": "…" }` is read with `useTranslations("nazar")("title")`.
 *
 * Adding a namespace: add it here, create both files, and add its type in `global.d.ts`.
 * `scripts/check-messages.mjs` and `src/lib/messages.test.ts` fail if this list and the files drift.
 */
export const MESSAGE_NAMESPACES = [
  "games",
  "nazar",
  "learnHub",
  "llSim",
  "sims",
  "me",
  "study",
  "curator",
  "ai",
  "flow",
] as const;

export type MessageNamespace = (typeof MESSAGE_NAMESPACES)[number];

type Tree = { [key: string]: unknown };

const isTree = (v: unknown): v is Tree => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep merge for message trees: objects merge key by key, anything else in `extra` wins. */
export function mergeMessages(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const prev = out[key];
    out[key] = isTree(prev) && isTree(value) ? mergeMessages(prev, value) : value;
  }
  return out;
}

/** The full catalogue for a locale: `messages/<locale>.json` plus every namespace file. */
export async function loadMessages(locale: AppLocale): Promise<Tree> {
  const [base, ...parts] = await Promise.all([
    import(`../../messages/${locale}.json`).then((m: { default: Tree }) => m.default),
    ...MESSAGE_NAMESPACES.map((ns) =>
      import(`../../messages/${locale}/${ns}.json`).then((m: { default: Tree }) => ({
        [ns]: m.default,
      })),
    ),
  ]);
  return parts.reduce<Tree>((acc, part) => mergeMessages(acc, part), base);
}
