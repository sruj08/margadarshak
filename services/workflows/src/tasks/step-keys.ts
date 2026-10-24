// Idempotency-Key helper for the P2 tasks. The API accepts keys of 16..64 characters
// (api/openapi.yaml components.parameters.IdempotencyKey), and Render run ids are long, so a key
// that would be too long keeps its readable prefix and replaces the rest with a sha256 digest.
// The same parts always give the same key.
import { createHash } from "node:crypto";

export const MIN_KEY_LENGTH = 16;
export const MAX_KEY_LENGTH = 64;

export function digestHex(parts: readonly string[], length = 16): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, length);
}

/** `prefix:part1:part2...`, or `prefix:<digest of the parts>` when that exceeds 64 characters. */
export function boundedKey(prefix: string, ...parts: readonly string[]): string {
  const plain = [prefix, ...parts].join(":");
  if (plain.length >= MIN_KEY_LENGTH && plain.length <= MAX_KEY_LENGTH) return plain;
  const room = Math.max(16, MAX_KEY_LENGTH - prefix.length - 1);
  return `${prefix}:${digestHex([prefix, ...parts], Math.min(room, 64))}`.slice(0, MAX_KEY_LENGTH);
}
