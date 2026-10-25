"use client";

import { writeVault } from "@/lib/case/vault";

/**
 * Details fetched from Aadhaar over DigiLocker while planning (simulated, synthetic account), held
 * only in this tab's sessionStorage until a case exists; then moved into the encrypted on-device
 * vault and cleared. Never sent to the server, never an Aadhaar number (D-07).
 */
export interface AadhaarPrefill {
  full_name: string;
  relative_name: string;
  home: string;
  dob: string;
}

const KEY = "md.plan.aadhaarPrefill.v1";

export function readPrefill(): AadhaarPrefill | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AadhaarPrefill) : null;
  } catch {
    return null;
  }
}

export function writePrefill(p: AadhaarPrefill | null): void {
  try {
    if (p) sessionStorage.setItem(KEY, JSON.stringify(p));
    else sessionStorage.removeItem(KEY);
  } catch {
    // private mode: the application will ask for these instead
  }
}

/** Moves a pending prefill into the case's vault. Returns whether there was one. */
export async function applyPrefill(caseId: string): Promise<boolean> {
  const p = readPrefill();
  if (!p) return false;
  await writeVault(caseId, { ...p });
  writePrefill(null);
  return true;
}
