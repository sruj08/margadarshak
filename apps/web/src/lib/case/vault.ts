"use client";

import { idbDel, idbGet, idbSet } from "@/lib/journey/idb";

/**
 * On-device vault (SCR-018 data note, PROJECT_BRIEF §15 "Copy-pack personal values"). Personal
 * values Sarathi will ask for on the non-Aadhaar path (name, relative's name, address) and the
 * application number stay on this phone, encrypted with a WebCrypto AES-GCM key that cannot be
 * exported. The server's hand-off pack (API-16) returns only labels and vault keys.
 */

export type VaultRecord = Record<string, string>;

const KEY_ID = "vault-key";

async function key(): Promise<CryptoKey | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const existing = await idbGet<CryptoKey>("vault", KEY_ID);
    if (existing && typeof existing === "object" && "algorithm" in existing) return existing;
    const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await idbSet("vault", KEY_ID, k);
    return k;
  } catch {
    return null;
  }
}

interface Sealed {
  iv: number[];
  data: number[];
}

export async function readVault(caseId: string): Promise<VaultRecord> {
  const raw = await idbGet<Sealed | VaultRecord>("vault", `case:${caseId}`);
  if (!raw) return {};
  if ("iv" in raw && Array.isArray(raw.iv)) {
    const k = await key();
    if (!k) return {};
    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(raw.iv as number[]) },
        k,
        new Uint8Array((raw as Sealed).data),
      );
      return JSON.parse(new TextDecoder().decode(plain)) as VaultRecord;
    } catch {
      return {};
    }
  }
  return raw as VaultRecord;
}

export async function writeVault(caseId: string, values: VaultRecord): Promise<void> {
  const merged = { ...(await readVault(caseId)), ...values };
  for (const [k, v] of Object.entries(merged)) if (v === "") delete merged[k];
  const k = await key();
  if (!k) {
    await idbSet("vault", `case:${caseId}`, merged);
    return;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    k,
    new TextEncoder().encode(JSON.stringify(merged)),
  );
  await idbSet("vault", `case:${caseId}`, { iv: [...iv], data: [...new Uint8Array(data)] });
}

export async function clearVault(caseId: string): Promise<void> {
  await idbDel("vault", `case:${caseId}`);
}
