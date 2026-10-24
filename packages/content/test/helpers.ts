// Shared fixtures for the content tests: the parsed pack (loaded once) and a deep-clone helper
// for negative tests that mutate a copy.
import type { Content } from "../src/model.ts";
import { loadContent, readRulepacks, readWordingTerms } from "../src/node.ts";

let cached: Content | undefined;

export function content(): Content {
  cached ??= loadContent();
  return cached;
}

/** A mutable deep copy of the pack for negative tests. */
export function cloneContent(): Content {
  return structuredClone(content());
}

export const rulepacks = () => ({ files: readRulepacks() });
export const wordingTerms = () => readWordingTerms();

/** Formats a list of issues for assertion messages. */
export function show(issues: readonly string[]): string {
  return issues.length === 0 ? "" : `\n  ${issues.slice(0, 40).join("\n  ")}`;
}
