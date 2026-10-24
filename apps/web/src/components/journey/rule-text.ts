"use client";

import { useMessages } from "next-intl";
import { useCallback } from "react";

/**
 * Rule-pack text lookup. Rule rows carry stable keys (`text_key`, `fix_key`, `label_key`,
 * `name_key`, step keys); their EN/HI copy lives in messages under `rk.<key>` (nested on the dots).
 * Missing keys fall back to the rule pack's English text, never to an empty string.
 */

type Tree = { [k: string]: string | Tree };

function lookup(tree: Tree | undefined, key: string): string | null {
  let node: string | Tree | undefined = tree;
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string") return null;
    node = node[part];
  }
  return typeof node === "string" ? node : null;
}

export function interpolate(text: string, values?: Record<string, string | number>): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

export function useRuleText() {
  const messages = useMessages() as unknown as { rk?: Tree };
  return useCallback(
    (
      key: string | null | undefined,
      fallback?: string,
      values?: Record<string, string | number>,
    ) => {
      const hit = key ? lookup(messages.rk, key) : null;
      return interpolate(hit ?? fallback ?? key ?? "", values);
    },
    [messages],
  );
}

export function useHasRuleText() {
  const messages = useMessages() as unknown as { rk?: Tree };
  return useCallback((key: string) => lookup(messages.rk, key) !== null, [messages]);
}
