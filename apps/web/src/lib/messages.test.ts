import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Messages } from "next-intl";
import { describe, expect, it } from "vitest";
import { loadMessages, MESSAGE_NAMESPACES, mergeMessages } from "@/i18n/messages";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";
import {
  compareCatalogues,
  loadCatalogues,
  namespaceFiles,
  signature,
  // @ts-expect-error plain ESM script without type declarations
} from "../../scripts/check-messages.mjs";

function flatten(obj: object, prefix = "", out = new Map<string, string>()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out.set(key, String(v));
  }
  return out;
}

const messagesDir = join(import.meta.dirname, "..", "..", "messages");

describe("message catalogues (MD-022, D-06)", () => {
  it("en and hi have the same keys, placeholders and tags (base file + namespace files)", () => {
    const loaded = loadCatalogues(messagesDir);
    expect(loaded.problems).toEqual([]);
    expect(compareCatalogues(loaded.catalogues)).toEqual([]);
  });

  it("the check catches a missing key and a dropped placeholder", () => {
    const broken = flatten(hi);
    broken.delete("home.h1");
    broken.set("trust.line", "बिना फ़ीस");
    const problems: string[] = compareCatalogues({ en: flatten(en), hi: broken });
    expect(problems.some((p) => p.includes("missing key home.h1"))).toBe(true);
    expect(problems.some((p) => p.includes("trust.line"))).toBe(true);
  });

  it("the trust line carries both fees as placeholders (formatted by formatInr), never literals", () => {
    expect(signature(en.trust.line)).toBe("args:fee_card,fee_one_class|tags:num");
    expect(en.trust.line).toContain("{fee_one_class}");
    expect(hi.trust.line).toContain("{fee_card}");
    const { raw } = loadCatalogues(messagesDir);
    for (const text of [JSON.stringify(raw.en), JSON.stringify(raw.hi)]) {
      expect(text).not.toMatch(/₹\s?\d/);
    }
  });

  it("the footer is the MC-001 non-affiliation text in both languages", () => {
    expect(en.footer.notAffiliated).toContain(
      "Not affiliated with MoRTH, NIC or any State Transport Department.",
    );
    expect(hi.footer.notAffiliated).toContain("संबद्ध नहीं");
  });
});

describe("P2 message namespaces (plan §3)", () => {
  it("every namespace is typed for useTranslations (global.d.ts AppConfig.Messages)", () => {
    // Compile-time check: fails tsc if a namespace is missing from global.d.ts.
    const typed: (keyof Messages)[] = [...MESSAGE_NAMESPACES];
    expect(typed).toHaveLength(MESSAGE_NAMESPACES.length);
  });

  it("the namespace files on disk are exactly the list request.ts loads, in both locales", () => {
    const expected = [...MESSAGE_NAMESPACES].sort();
    expect(namespaceFiles(messagesDir, "en")).toEqual(expected);
    expect(namespaceFiles(messagesDir, "hi")).toEqual(expected);
  });

  it("loadMessages deep-merges every namespace under its own key, next to the base catalogue", async () => {
    for (const locale of ["en", "hi"] as const) {
      const messages = await loadMessages(locale);
      for (const ns of MESSAGE_NAMESPACES) expect(messages[ns]).toBeTypeOf("object");
      expect(messages["footer"]).toEqual((locale === "en" ? en : hi).footer);
    }
  });

  it("mergeMessages merges nested objects and lets the later file win on leaves", () => {
    expect(mergeMessages({ a: { x: "1", y: "2" }, b: "k" }, { a: { y: "3", z: "4" } })).toEqual({
      a: { x: "1", y: "3", z: "4" },
      b: "k",
    });
  });

  it("the check flags namespace drift, collisions with en.json keys and wrapped bodies", () => {
    const dir = mkdtempSync(join(tmpdir(), "md-msgs-"));
    try {
      writeFileSync(join(dir, "en.json"), JSON.stringify({ footer: { a: "A" } }));
      writeFileSync(join(dir, "hi.json"), JSON.stringify({ footer: { a: "अ" } }));
      mkdirSync(join(dir, "en"));
      mkdirSync(join(dir, "hi"));
      writeFileSync(join(dir, "en", "nazar.json"), JSON.stringify({ nazar: { t: "Tap" } }));
      writeFileSync(join(dir, "hi", "nazar.json"), JSON.stringify({ nazar: { t: "टैप" } }));
      writeFileSync(join(dir, "en", "footer.json"), JSON.stringify({ b: "B" }));
      writeFileSync(join(dir, "hi", "footer.json"), JSON.stringify({ b: "ब" }));
      writeFileSync(join(dir, "en", "games.json"), JSON.stringify({ title: "Games" }));
      const { problems, catalogues } = loadCatalogues(dir);
      expect(problems).toContain("hi: missing namespace file hi/games.json");
      expect(problems.some((p: string) => p.includes("footer is already a top-level key"))).toBe(
        true,
      );
      expect(problems.some((p: string) => p.includes('wraps its body in "nazar"'))).toBe(true);
      expect(catalogues.en.get("games.title")).toBe("Games");
      expect(compareCatalogues(catalogues)).toContain("hi: missing key games.title");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
